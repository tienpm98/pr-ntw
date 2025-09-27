import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManagerWithProxyShuffling,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { pharosTokenAddress } from "@scripts/lib/data";
import { swap } from "@scripts/pharosNetwork/rwafiR2/swap";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";
import { tokenBalance } from "@scripts/utils/balance";
import fs from "fs";

// Configuration for R2 swap
const router = "0x4f5b54d4af2568cefafa73bb062e5d734b55aa05";
const usdcAddress = pharosTokenAddress.filter(
  (item) => item.name == "USDC_R2"
)[0].address;
const r2usdAddress = pharosTokenAddress.filter(
  (item) => item.name == "R2USD"
)[0].address;

/**
 * Generate a random delay between 20-40 seconds
 */
function randomDelay(): number {
  return Math.floor(
    randomAmount({
      min: 20000,
      max: 40000,
    })
  );
}

/**
 * Generate a random fixed amount between 10-20 tokens
 */
function getRandomFixedAmount(): number {
  return Math.floor(Math.random() * (20 - 10 + 1)) + 10;
}

/**
 * Perform swap operations for a single wallet in parallel
 */
async function swapForWallet(
  wallet: WalletInstance,
  index: number,
  fixedAmount?: number
) {
  const amountToUse = fixedAmount || getRandomFixedAmount(); // Use fixed amount instead of percentage
  
  try {
    console.log(
      `[${wallet.name}] Starting RWAFI R2 swaps from address: ${wallet.address}`
    );
    console.log(
      `[${wallet.name}] Using fixed amount: ${amountToUse} tokens per swap`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    // Check USDC balance first
    const usdcBalance = await tokenBalance({
      address: wallet.address,
      provider: wallet.signer.provider as any,
      tokenAddress: usdcAddress,
    });

    // Check R2USD balance
    const r2usdBalance = await tokenBalance({
      address: wallet.address,
      provider: wallet.signer.provider as any,
      tokenAddress: r2usdAddress,
    });

    // Calculate required USDC amount for swap (using fixed amount)
    const requiredUsdcAmount = BigInt(amountToUse) * (10n ** 6n); // USDC has 6 decimals

    console.log(
      `[${wallet.name}] USDC Balance: ${usdcBalance.balance} ${usdcBalance.symbol}`
    );
    console.log(
      `[${wallet.name}] R2USD Balance: ${r2usdBalance.balance} ${r2usdBalance.symbol}`
    );
    console.log(
      `[${wallet.name}] Required USDC for ${amountToUse} token swap: ${requiredUsdcAmount}`
    );

    // Check if we have enough USDC for the planned swap
    if (usdcBalance.balance >= requiredUsdcAmount && requiredUsdcAmount > 0n) {
      // Normal flow: USDC -> R2USD -> USDC
      console.log(
        `[${wallet.name}] Sufficient USDC found. Proceeding with normal swap flow.`
      );

      // First swap: USDC -> R2USD
      console.log(
        `[${wallet.name}] Swapping ${amountToUse} USDC -> R2USD`
      );
      await swap({
        tokenIn: usdcAddress,
        tokenOut: r2usdAddress,
        router,
        signer: wallet.signer,
        provider: wallet.signer.provider as any,
        fixedAmount: amountToUse,
      });

      // Small delay between swaps
      console.log(`[${wallet.name}] Waiting 5 seconds before reverse swap...`);
      await sleep(5000);

      // Second swap: R2USD -> USDC (swap back)
      console.log(`[${wallet.name}] Swapping 100% R2USD -> USDC (swap back)`);
      await swap({
        tokenIn: r2usdAddress,
        tokenOut: usdcAddress,
        router,
        signer: wallet.signer,
        provider: wallet.signer.provider as any,
        amountInPercent: 100, // Use 100% of R2USD balance for swap back
      });

      console.log(
        `[${wallet.name}] RWAFI R2 round-trip swaps completed successfully (${amountToUse} tokens used)`
      );

      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
        fixedAmountUsed: amountToUse,
        swapType: "round-trip",
      };
    } else {
      // Fallback: Check if we have R2USD to swap back to USDC
      if (r2usdBalance.balance > 0n) {
        console.log(
          `[${wallet.name}] Insufficient USDC for swap. Converting all R2USD back to USDC.`
        );

        // Swap all R2USD -> USDC
        console.log(
          `[${wallet.name}] Swapping 100% R2USD -> USDC (recovery swap)`
        );
        await swap({
          tokenIn: r2usdAddress,
          tokenOut: usdcAddress,
          router,
          signer: wallet.signer,
          provider: wallet.signer.provider as any,
          amountInPercent: 100, // Use 100% of R2USD balance
        });

        console.log(
          `[${wallet.name}] RWAFI R2 recovery swap completed successfully (all R2USD converted to USDC)`
        );

        return {
          success: true,
          wallet: wallet.name,
          address: wallet.address,
          percentageUsed: 100,
          swapType: "recovery",
        };
      } else {
        console.log(
          `[${wallet.name}] No sufficient USDC or R2USD for any swap operation.`
        );

        return {
          success: false,
          wallet: wallet.name,
          address: wallet.address,
          error: "Insufficient balance for any swap operation",
          percentageUsed: 0,
          swapType: "none",
        };
      }
    }
  } catch (error) {
    failed({ errorMessage: `[${wallet.name}] Error: ${error}` });
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error,
      fixedAmountUsed: amountToUse,
      swapType: "error",
    };
  }
}

/**
 * Main function to run parallel R2 swaps for all wallets
 */
async function main() {
  try {
    // Load wallet configuration with automatic proxy shuffling
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManagerWithProxyShuffling(configPath);
    const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const concurrentTasks = configData.settings.concurrentTasks || 1;

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(
      `[BATCH MODE] Will run RWAFI R2 swaps ${concurrentTasks} times as specified in config`
    );

    // Generate random fixed amounts for each round
    console.log(
      `[BATCH MODE] Using fixed amounts (10-20 tokens) per swap for predictable operations across ${concurrentTasks} rounds`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute swaps for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;
    let swapTypeStats = {
      "round-trip": 0,
      recovery: 0,
      none: 0,
      error: 0,
    };

    // Run swap operations concurrentTasks times (94 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => swapForWallet(wallet, index) // Use random fixed amounts
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      // Collect swap type statistics
      results.forEach((r) => {
        if (r.swapType && swapTypeStats.hasOwnProperty(r.swapType)) {
          swapTypeStats[r.swapType as keyof typeof swapTypeStats]++;
        }
      });

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } RWAFI R2 swap operations were successful`
      );

      // Add a delay between rounds to avoid rate limiting
      if (i < concurrentTasks - 1) {
        const roundDelay = randomDelay();
        console.log(
          `[BATCH ROUND] Waiting ${(roundDelay / 1000).toFixed(
            1
          )}s before next round...`
        );
        await sleep(roundDelay);
      }
    }

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    console.log(
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} RWAFI R2 swap operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );

    // Print swap type statistics
    console.log("\n[SWAP TYPE STATISTICS]");
    console.log(
      `- Round-trip swaps (USDC->R2USD->USDC): ${swapTypeStats["round-trip"]}`
    );
    console.log(
      `- Recovery swaps (R2USD->USDC only): ${swapTypeStats["recovery"]}`
    );
    console.log(`- No swaps (insufficient balance): ${swapTypeStats["none"]}`);
    console.log(`- Errors: ${swapTypeStats["error"]}`);
  } catch (error) {
    console.error("[BATCH ERROR] Error running parallel R2 swaps:", error);
  }
}

main().catch(console.error);

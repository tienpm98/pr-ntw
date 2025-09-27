import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { pharosTokenAddress } from "@scripts/lib/data";
import { swap } from "@scripts/pharosNetwork/rwafiR2/earnSavings";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";
import { tokenBalance } from "@scripts/utils/balance";
import fs from "fs";

const router = "0xf8694d25947a0097cb2cea2fc07b071bdf72e1f8";

// Token addresses for R2 operations
const usdcAddress = pharosTokenAddress.filter(
  (item) => item.name == "USDC_R2"
)[0].address;
const r2usdAddress = pharosTokenAddress.filter(
  (item) => item.name == "R2USD"
)[0].address;
const sr2usdAddress = pharosTokenAddress.filter(
  (item) => item.name == "SR2USD"
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
 * Convert 90% of USDC balance to R2USD for all wallets (ONE-TIME SETUP)
 */
async function initialUsdcToR2usdConversion(walletManager: any): Promise<void> {
  console.log(
    `\n[INITIAL SETUP] Converting 90% USDC to R2USD for all wallets (ONE-TIME ONLY)...`
  );

  const conversionPromises = walletManager.wallets.map(
    async (wallet: WalletInstance, index: number) => {
      try {
        console.log(
          `[${wallet.name}] Checking USDC balance for initial conversion...`
        );

        // Check current USDC balance
        const usdcBalance = await tokenBalance({
          address: wallet.address,
          provider: wallet.signer.provider as any,
          tokenAddress: usdcAddress,
        });

        if (usdcBalance.balance <= 0n) {
          console.log(`[${wallet.name}] No USDC found, skipping conversion`);
          return { wallet: wallet.name, success: true, reason: "no_usdc" };
        }

        // Calculate 90% of USDC balance for conversion
        const conversionPercentage = 90;

        console.log(
          `[${
            wallet.name
          }] Converting ${conversionPercentage}% USDC to R2USD (${usdcBalance.balance.toString()} balance)`
        );

        // Use the swap function from rwafiR2/swap for USDC -> R2USD
        const { swap: swapFromSwapModule } = await import(
          "@scripts/pharosNetwork/rwafiR2/swap"
        );

        await swapFromSwapModule({
          tokenIn: usdcAddress,
          tokenOut: r2usdAddress,
          router: "0x4f5b54d4af2568cefafa73bb062e5d734b55aa05", // R2 swap router
          signer: wallet.signer,
          provider: wallet.signer.provider as any,
          amountInPercent: conversionPercentage,
        });

        console.log(
          `[${wallet.name}] ✅ Successfully converted ${conversionPercentage}% USDC to R2USD`
        );
        return { wallet: wallet.name, success: true, reason: "converted" };
      } catch (error) {
        console.error(
          `[${wallet.name}] ❌ Failed to convert USDC to R2USD: ${error}`
        );
        return {
          wallet: wallet.name,
          success: false,
          error,
          reason: "conversion_failed",
        };
      }
    }
  );

  // Execute all conversions in parallel
  const results = await Promise.all(conversionPromises);

  // Summary of initial conversion
  const successful = results.filter(
    (r) => r.success && r.reason === "converted"
  ).length;
  const noUsdc = results.filter(
    (r) => r.success && r.reason === "no_usdc"
  ).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n[INITIAL SETUP COMPLETE]`);
  console.log(`  ✅ Successful conversions: ${successful}`);
  console.log(`  ⚪ No USDC to convert: ${noUsdc}`);
  console.log(`  ❌ Failed conversions: ${failed}`);
  console.log(`[INITIAL SETUP] Ready to start earn savings operations...\n`);
}

/**
 * Perform RWAFI R2 earn savings operations for a single wallet in parallel
 */
async function earnSavingsForWallet(
  wallet: WalletInstance,
  index: number,
  fixedAmount?: number
) {
  const amountToUse = fixedAmount || getRandomFixedAmount(); // Use fixed amount instead of percentage

  try {
    console.log(
      `[${wallet.name}] Starting RWAFI R2 earn savings from address: ${wallet.address} (using ${amountToUse} tokens)`
    );

    // Apply random delay before starting main action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting earn savings...`
    );
    await sleep(delayMs);

    // Perform R2USD -> SR2USD earn savings operation

    try {
      console.log(
        `[${wallet.name}] Swapping ${amountToUse} tokens R2USD -> SR2USD`
      );
      await swap({
        tokenIn: r2usdAddress,
        tokenOut: sr2usdAddress,
        router,
        signer: wallet.signer,
        provider: wallet.signer.provider as any,
        fixedAmount: amountToUse,
      });

      console.log(
        `[${wallet.name}] Successfully completed RWAFI R2 earn savings (${amountToUse} tokens swapped)`
      );
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
        fixedAmountUsed: amountToUse,
      };
    } catch (error) {
      console.error(`[${wallet.name}] RWAFI R2 earn savings failed: ${error}`);
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
        fixedAmountUsed: amountToUse,
      };
    }
  } catch (error) {
    failed({ errorMessage: `[${wallet.name}] Error: ${error}` });
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error,
      fixedAmountUsed: amountToUse,
    };
  }
}

/**
 * Main function to run parallel RWAFI R2 earn savings for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);
    const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const concurrentTasks = configData.settings.concurrentTasks || 1;

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(
      `[BATCH MODE] Will run RWAFI R2 earn savings ${concurrentTasks} times as specified in config`
    );
    console.log(`[BATCH MODE] ============================================`);
    console.log(`[BATCH MODE] PHASE 1: ONE-TIME USDC → R2USD CONVERSION`);
    console.log(
      `[BATCH MODE] PHASE 2: REPEATED R2USD → SR2USD (${concurrentTasks}x)`
    );
    console.log(`[BATCH MODE] ============================================`);

    // STEP 1: One-time USDC to R2USD conversion for all wallets
    await initialUsdcToR2usdConversion(walletManager);

    // STEP 2: Main earn savings operations with fixed amounts
    console.log(`[BATCH MODE] ============================================`);
    console.log(
      `[BATCH MODE] PHASE 2: Using fixed amounts (10-20 tokens) R2USD → SR2USD across ${concurrentTasks} rounds`
    );
    console.log(`[BATCH MODE] ============================================`);

    // Generate random fixed amounts for each round
    console.log(
      `[BATCH MODE] Using fixed amounts (10-20 tokens) per swap for predictable operations across ${concurrentTasks} rounds`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute earn savings for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;

    // Run earn savings operations concurrentTasks times (94 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => earnSavingsForWallet(wallet, index) // Use random fixed amounts
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } RWAFI R2 earn savings operations were successful`
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
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} RWAFI R2 earn savings operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel RWAFI R2 earn savings:",
      error
    );
  }
}

main().catch(console.error);

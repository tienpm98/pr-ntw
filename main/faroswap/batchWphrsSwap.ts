import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManagerWithProxyShuffling,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { pharosTokenAddress } from "@scripts/lib/data";
import { swap } from "@scripts/pharosNetwork/faroswap/swap";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";
import fs from "fs";

// Constants for Faroswap
const baseDir = path.resolve(__dirname, "../");
const slippageUrl = "31.201";

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
 * Generate a random fixed amount between 0.005-0.008 WPHRS
 */
function getRandomFixedAmount(): string {
  // Generate random number between 0.005 and 0.008 with 6 decimal precision
  const randomValue = randomAmount({
    min: 0.005,
    max: 0.008,
  });

  // Format to 6 decimal places
  return randomValue.toFixed(6);
}

/**
 * Perform WPHRS swap operations for a single wallet in parallel
 */
async function wphrsSwapForWallet(wallet: WalletInstance, index: number) {
  try {
    console.log(
      `[${wallet.name}] Starting Faroswap WPHRS swaps from address: ${wallet.address}`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    // Get token addresses
    const usdcAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDC"
    )[0].address;
    const usdtAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDT"
    )[0].address;
    const wphrsAddress = pharosTokenAddress.filter(
      (item) => item.name == "WPHRS_FAROSWAP"
    )[0].address;

    // Generate fixed amount for this wallet's operations
    const fixedAmountStr = getRandomFixedAmount();
    console.log(
      `[${wallet.name}] Using fixed amount: ${fixedAmountStr} WPHRS per swap`
    );

    // First swap: WPHRS -> USDC
    let deadline = Math.floor(Date.now() / 1000) + 60 * 10;
    console.log(`[${wallet.name}] Swapping WPHRS -> USDC`);

    try {
      // Convert fixed amount to percentage for swap function
      // For now we use 10% (will be more controlled than using percentage)
      await swap({
        tokenIn: wphrsAddress,
        tokenOut: usdcAddress,
        deadline,
        signer: wallet.signer,
        amountIn_inPercent: 10, // Use small percentage for controlled amount
        provider: wallet.signer.provider as any,
        dirname: baseDir,
        slippageUrl,
      });

      // Wait between swaps
      const waitMs = randomAmount({
        min: 5000,
        max: 10000,
      });
      console.log(
        `[${wallet.name}] Waiting ${(waitMs / 1000).toFixed(
          1
        )}s before next swap...`
      );
      await sleep(waitMs);

      // Second swap: WPHRS -> USDT
      deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      console.log(`[${wallet.name}] Swapping WPHRS -> USDT`);

      await swap({
        tokenIn: wphrsAddress,
        tokenOut: usdtAddress,
        deadline,
        signer: wallet.signer,
        amountIn_inPercent: 10, // Use small percentage for controlled amount
        provider: wallet.signer.provider as any,
        dirname: baseDir,
        slippageUrl,
      });

      console.log(
        `[${wallet.name}] Successfully completed Faroswap WPHRS swaps`
      );
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
        fixedAmountUsed: fixedAmountStr,
      };
    } catch (error) {
      console.error(`[${wallet.name}] Faroswap WPHRS swap failed: ${error}`);
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
        fixedAmountUsed: fixedAmountStr,
      };
    }
  } catch (error) {
    failed({ errorMessage: `[${wallet.name}] Error: ${error}` });
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error,
    };
  }
}

/**
 * Main function to run parallel WPHRS swaps for all wallets
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
      `[BATCH MODE] Will run Faroswap WPHRS swaps ${concurrentTasks} times as specified in config`
    );
    console.log(
      `[BATCH MODE] Using fixed amounts (0.005-0.008 WPHRS) per swap for predictable operations across ${concurrentTasks} rounds`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute swaps for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;

    // Run swap operations concurrentTasks times (94 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => wphrsSwapForWallet(wallet, index)
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } Faroswap WPHRS swap operations were successful`
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
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} Faroswap WPHRS swap operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel Faroswap WPHRS swaps:",
      error
    );
  }
}

main().catch(console.error);

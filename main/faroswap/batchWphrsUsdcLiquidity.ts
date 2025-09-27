import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManagerWithProxyShuffling,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import {
  pharosTokenAddress,
  pharosPoolAddressPMMFaroswap,
} from "@scripts/lib/data";
import { createLiquidity } from "@scripts/pharosNetwork/faroswap/liquidity";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";
import fs from "fs";

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
 * Generate a random fixed amount between 0.005-0.008 WPHRS for liquidity
 * This is implemented by using a fixed percentage rather than actual fixed amounts
 * since the liquidity function only supports percentage-based inputs
 */
function getRandomFixedPercentage(): number {
  // For WPHRS-USDC liquidity, we'll use a small percentage (5-10%)
  return Math.floor(
    randomAmount({
      min: 5,
      max: 10,
    })
  );
}

/**
 * Perform WPHRS-USDC liquidity operations for a single wallet in parallel
 */
async function wphrsUsdcLiquidityForWallet(
  wallet: WalletInstance,
  index: number
) {
  try {
    console.log(
      `[${wallet.name}] Starting Faroswap WPHRS-USDC liquidity from address: ${wallet.address}`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    const usdcAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDC"
    )[0].address;
    const wphrsAddress = pharosTokenAddress.filter(
      (item) => item.name == "WPHRS_FAROSWAP"
    )[0].address;

    // Get random percentage for this operation (simulating fixed amount)
    const amountInPercent = getRandomFixedPercentage();
    console.log(
      `[${wallet.name}] Using percentage: ${amountInPercent}% for WPHRS-USDC liquidity`
    );

    try {
      // USDC/WPHRS pools
      let poolAddresses = pharosPoolAddressPMMFaroswap.filter(
        (item) => item.pair == "USDC/WPHRS"
      )[0];

      for (let poolAddress of poolAddresses.address) {
        let deadline = Math.floor(Date.now() / 1000) + 60 * 10;
        console.log(
          `[${wallet.name}] Adding USDC/WPHRS liquidity to pool: ${poolAddress}`
        );

        await createLiquidity({
          poolAddress: poolAddress,
          tokenIn: usdcAddress,
          tokenOut: wphrsAddress,
          deadline,
          signer: wallet.signer,
          amountIn_inPercent: amountInPercent,
          provider: wallet.signer.provider as any,
        });

        // Small delay between operations
        await sleep(2000);
      }

      console.log(
        `[${wallet.name}] Successfully added Faroswap WPHRS-USDC liquidity`
      );
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
        percentageUsed: amountInPercent,
      };
    } catch (error) {
      console.error(
        `[${wallet.name}] Faroswap WPHRS-USDC liquidity failed: ${error}`
      );
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
        percentageUsed: amountInPercent,
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
 * Main function to run parallel WPHRS-USDC liquidity operations for all wallets
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
      `[BATCH MODE] Will run Faroswap WPHRS-USDC liquidity ${concurrentTasks} times as specified in config`
    );
    console.log(`[BATCH MODE] Using percentage (5-10%) for controlled amounts`);
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute liquidity operations for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;

    // Run liquidity operations concurrentTasks times (94 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => wphrsUsdcLiquidityForWallet(wallet, index)
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } Faroswap WPHRS-USDC liquidity operations were successful`
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
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} Faroswap WPHRS-USDC liquidity operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel WPHRS-USDC liquidity operations:",
      error
    );
  }
}

main().catch(console.error);

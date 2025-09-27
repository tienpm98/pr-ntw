import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import {
  pharosTokenAddress,
  pharosPoolAddressPMMFaroswap,
} from "@scripts/lib/data";
import { createLiquidity } from "@scripts/pharosNetwork/faroswap/liquidity";
import { sleep } from "@scripts/utils/time";
import { randomAmount } from "@scripts/utils/amount";
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
 * Perform Faroswap USDT liquidity operations for a single wallet in parallel
 */
async function usdtLiquidityForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting Faroswap USDT liquidity from address: ${wallet.address}`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    const usdtAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDT"
    )[0].address;
    const wphrsAddress = pharosTokenAddress.filter(
      (item) => item.name == "WPHRS_FAROSWAP"
    )[0].address;

    try {
      const poolAddresses = pharosPoolAddressPMMFaroswap.filter(
        (item) => item.pair == "USDT/WPHRS"
      )[0];

      for (let poolAddress of poolAddresses.address) {
        let deadline = Math.floor(Date.now() / 1000) + 60 * 10;
        console.log(
          `[${wallet.name}] Adding USDT/WPHRS liquidity to pool: ${poolAddress}`
        );

        await createLiquidity({
          poolAddress: poolAddress,
          tokenIn: usdtAddress,
          tokenOut: wphrsAddress,
          deadline,
          signer: wallet.signer,
          amountIn_inPercent: amountInPercent,
          provider: wallet.signer.provider as any,
        });

        // Small delay between pools to avoid transaction collisions
        await sleep(2000);
      }

      console.log(
        `[${wallet.name}] Successfully added Faroswap USDT liquidity`
      );
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(
        `[${wallet.name}] Faroswap USDT liquidity failed: ${error}`
      );
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
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
 * Main function to run parallel Faroswap USDT liquidity operations for all wallets
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
      `[BATCH MODE] Will run USDT liquidity ${concurrentTasks} times as specified in config`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute liquidity operations for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;

    // Run liquidity operations concurrentTasks times (91 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => usdtLiquidityForWallet(wallet, index, 50) // Use 50% for amount in percent
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } Faroswap USDT liquidity operations were successful`
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
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} Faroswap USDT liquidity operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel Faroswap USDT liquidity operations:",
      error
    );
  }
}

main().catch(console.error);

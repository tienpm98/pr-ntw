import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { faucet } from "@scripts/pharosNetwork/lendBorrowOpenfi/faucet";
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
 * Perform OpenFi faucet operations for a single wallet in parallel
 */
async function faucetForWallet(wallet: WalletInstance, index: number) {
  try {
    console.log(
      `[${wallet.name}] Starting OpenFi faucet from address: ${wallet.address}`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    try {
      await faucet({
        signer: wallet.signer,
      });

      console.log(`[${wallet.name}] Successfully claimed OpenFi faucet`);
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(`[${wallet.name}] OpenFi faucet failed: ${error}`);
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
 * Main function to run parallel OpenFi faucet operations for all wallets
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
      `[BATCH MODE] Will run faucet ${concurrentTasks} times as specified in config`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute faucet operations for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;

    // Run faucet operations concurrentTasks times (91 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => faucetForWallet(wallet, index)
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } OpenFi faucet operations were successful`
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
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} OpenFi faucet operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel OpenFi faucet operations:",
      error
    );
  }
}

main().catch(console.error);

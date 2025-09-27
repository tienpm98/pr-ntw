import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  executeWalletsWithConcurrency,
  executeWalletsMultipleTimes,
  executeWalletsInParallelMultipleTimes,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { faucet } from "@scripts/pharosNetwork/autostaking/faucet";
import { sleep } from "@scripts/utils/time";

/**
 * Hàm thực hiện retry khi gặp lỗi
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 10,
  delayMs: number = 5000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Chi tiết hơn về lỗi
      console.error(
        `Attempt ${attempt}/${maxRetries} failed: ${error.message || error}`
      );

      if (attempt < maxRetries) {
        const waitTime = delayMs * attempt; // Tăng thời gian chờ sau mỗi lần thử
        console.log(`Retrying in ${waitTime / 1000} seconds...`);
        await sleep(waitTime);
      }
    }
  }

  throw new Error(
    `Failed after ${maxRetries} attempts. Last error: ${
      lastError.message || lastError
    }`
  );
}

/**
 * Execute faucet for a single wallet in parallel
 */
async function claimFaucetForWallet(
  wallet: WalletInstance,
  index: number,
  runCount: number = 0
) {
  try {
    console.log(
      `[${wallet.name}] Claiming faucet from address: ${wallet.address} (Run ${
        runCount + 1
      })`
    );

    // Log the wallet being used
    console.log(`[${wallet.name}] Using wallet address: ${wallet.address}`);

    // Sử dụng retry cho faucet
    await executeWithRetry(async () => {
      return await faucet({
        signer: wallet.signer,
      });
    });

    console.log(`[${wallet.name}] Successfully claimed faucet`);
    return {
      success: true,
      wallet: wallet.name,
      address: wallet.address,
    };
  } catch (error) {
    failed({
      errorMessage: `[${wallet.name}] Error: ${
        error instanceof Error ? error.message : error
      }`,
    });
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error,
    };
  }
}

/**
 * Main function to run parallel faucet claims for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);

    // Get concurrentTasks from wallets.json settings for number of runs per wallet
    const runsPerWallet = walletManager.settings.concurrentTasks || 1;

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(
      `[BATCH MODE] Processing all wallets in parallel, each wallet running ${runsPerWallet} times (total operations: ${
        walletManager.wallets.length * runsPerWallet
      })`
    );

    // Execute all wallets in parallel, with each wallet running its task multiple times
    const startTime = Date.now();

    const results = await executeWalletsInParallelMultipleTimes(
      walletManager,
      async (wallet, index, runCount) =>
        claimFaucetForWallet(wallet, index, runCount),
      runsPerWallet
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} faucet claims were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );

    // Log failed operations for debugging
    const failed = results.filter((r) => !r.success).length;
    if (failed > 0) {
      console.log(`\n[FAILED OPERATIONS]`);
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(`  ${r.wallet} (${r.address}): ${r.error}`);
        });
    }

    process.exit(0);
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel wallet faucet claims:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Unhandled error:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});

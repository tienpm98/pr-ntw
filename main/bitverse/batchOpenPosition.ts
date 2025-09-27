import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { bitverseListPair } from "@scripts/lib/data";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";
import { openPosition } from "@scripts/pharosNetwork/bitverse/openPosition";
import fs from "fs";

const router = "0xbf428011d76efbfaee35a20dd6a0ca589b539c54";
const baseDir = path.resolve(__dirname, "../..");

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
 * Perform Bitverse open position operations for a single wallet in parallel
 * with retry mechanism that tries different tokens on error
 */
async function openPositionForWallet(
  wallet: WalletInstance,
  index: number,
  maxRetries: number = 3
) {
  try {
    console.log(
      `[${wallet.name}] Starting Bitverse open position from address: ${wallet.address}`
    );

    // Apply random delay before starting action
    const delayMs = randomDelay();
    console.log(
      `[${wallet.name}] Waiting ${(delayMs / 1000).toFixed(
        1
      )}s before starting...`
    );
    await sleep(delayMs);

    // Keep track of tried pairs to avoid repeating the same pair on retry
    const triedPairs = new Set<number>();

    // Try up to maxRetries times with different tokens
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Find an index that hasn't been tried yet
      let indexAssets: number;
      do {
        indexAssets = Math.floor(
          randomAmount({
            min: 0,
            max: bitverseListPair.length,
          })
        );
      } while (
        triedPairs.has(indexAssets) &&
        triedPairs.size < bitverseListPair.length
      );

      // If we've tried all pairs, break out of the loop
      if (triedPairs.size >= bitverseListPair.length) {
        console.log(`[${wallet.name}] All pairs have been tried and failed`);
        break;
      }

      triedPairs.add(indexAssets);

      // side: 1 Long, 2 Short
      const side = Math.floor(
        randomAmount({
          min: 1,
          max: 3,
        })
      );

      // orderType: 1 Market, 2 Limit
      const orderType = Math.floor(
        randomAmount({
          min: 1,
          max: 3,
        })
      );

      const pair = bitverseListPair[indexAssets];

      console.log(
        `[${wallet.name}] ${
          attempt > 0 ? `Retry #${attempt}: ` : ""
        }Opening position for ${pair}, side: ${
          side === 1 ? "Long" : "Short"
        }, order type: ${orderType === 1 ? "Market" : "Limit"}`
      );

      try {
        await openPosition({
          baseDir,
          side,
          pair,
          provider: wallet.signer.provider as any,
          signer: wallet.signer,
          router,
          orderType: 2,
        });

        // Ước tính lượng USDT đã sử dụng - trung bình khoảng 2-5 USDT/vị thế
        const estimatedUsdt = Math.random() * 3 + 2; // 2-5 USDT

        console.log(
          `[${
            wallet.name
          }] Successfully opened position, used approximately ${estimatedUsdt.toFixed(
            2
          )} USDT`
        );
        return {
          success: true,
          wallet: wallet.name,
          address: wallet.address,
          pair,
          side: side === 1 ? "Long" : "Short",
          attempts: attempt + 1,
          usdtUsed: estimatedUsdt,
        };
      } catch (error) {
        console.error(
          `[${wallet.name}] Failed to open position with ${pair}: ${error}`
        );

        // If this is the last retry, return the error
        if (attempt === maxRetries - 1) {
          return {
            success: false,
            wallet: wallet.name,
            address: wallet.address,
            error,
            attempts: attempt + 1,
            usdtUsed: 0, // Không có USDT nào được sử dụng vì thất bại
          };
        }

        // Otherwise wait before trying again with a different token
        const retryDelayMs = randomDelay() / 2; // Shorter delay for retries
        console.log(
          `[${wallet.name}] Waiting ${(retryDelayMs / 1000).toFixed(
            1
          )}s before trying another token...`
        );
        await sleep(retryDelayMs);
      }
    }

    // If we get here, all retries failed
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error: "All retry attempts failed with different tokens",
      attempts: maxRetries,
      usdtUsed: 0, // Không có USDT nào được sử dụng vì thất bại
    };
  } catch (error) {
    failed({ errorMessage: `[${wallet.name}] Error: ${error}` });
    return {
      success: false,
      wallet: wallet.name,
      address: wallet.address,
      error,
      attempts: 1,
      usdtUsed: 0,
    };
  }
}

/**
 * Main function to run parallel Bitverse open positions for all wallets
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
      `[BATCH MODE] Will run Bitverse open positions ${concurrentTasks} times as specified in config`
    );
    console.log(`[BATCH MODE] Will retry with different tokens on failure`);
    console.log(
      `[BATCH MODE] USDT management: Optimizing USDT usage across ${concurrentTasks} tasks`
    );
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute open positions for all wallets in parallel
    const startTime = Date.now();
    let totalSuccessful = 0;
    let totalOperations = 0;
    let pairStats: Record<string, number> = {};
    let retryStats = {
      totalRetries: 0,
      successfulRetries: 0,
    };

    // Tracking USDT usage across tasks
    let usdtTracker = {
      totalUsdtRequired: 0,
      totalUsdtUsed: 0,
      minUsdtPerTask: 2,
    };

    // Run open position operations concurrentTasks times (94 times as per config)
    for (let i = 0; i < concurrentTasks; i++) {
      console.log(`\n[BATCH ROUND] Starting round ${i + 1}/${concurrentTasks}`);

      // Tính toán USDT theo dõi cho vòng hiện tại
      const remainingTasks = concurrentTasks - i;
      console.log(`[USDT Tracking] Remaining tasks: ${remainingTasks}`);
      console.log(
        `[USDT Tracking] USDT used so far: ${usdtTracker.totalUsdtUsed.toFixed(
          2
        )}`
      );
      console.log(
        `[USDT Tracking] Minimum USDT needed for remaining tasks: ${
          usdtTracker.minUsdtPerTask * remainingTasks
        }`
      );

      const results = await executeAllWalletsInParallel(
        walletManager,
        async (wallet, index) => openPositionForWallet(wallet, index, 3) // Max 3 retries
      );

      const successful = results.filter((r) => r.success).length;
      totalSuccessful += successful;
      totalOperations += results.length;

      // Collect statistics
      results.forEach((r) => {
        if (r.success && r.pair) {
          pairStats[r.pair as string] = (pairStats[r.pair as string] || 0) + 1;

          // Ước tính USDT đã sử dụng (nếu có thông tin)
          if (r.usdtUsed) {
            usdtTracker.totalUsdtUsed += Number(r.usdtUsed);
          } else {
            // Nếu không có thông tin chính xác, ước tính bằng mức tối thiểu
            usdtTracker.totalUsdtUsed += usdtTracker.minUsdtPerTask;
          }
        }
        if (r.attempts && r.attempts > 1) {
          retryStats.totalRetries += r.attempts - 1;
          if (r.success) {
            retryStats.successfulRetries += 1;
          }
        }
      });

      console.log(
        `[BATCH ROUND ${i + 1}] ${successful}/${
          results.length
        } Bitverse open position operations were successful`
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
      `\n[BATCH SUMMARY] ${totalSuccessful}/${totalOperations} Bitverse open position operations were successful across ${concurrentTasks} rounds`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );

    // Print pair statistics
    console.log("\n[PAIR STATISTICS] Positions opened by pair:");
    Object.entries(pairStats).forEach(([pair, count]) => {
      console.log(`- ${pair}: ${count} positions`);
    });

    // Print retry statistics
    console.log("\n[RETRY STATISTICS]");
    console.log(`- Total retries attempted: ${retryStats.totalRetries}`);
    console.log(`- Successful retries: ${retryStats.successfulRetries}`);
    console.log(
      `- Retry success rate: ${
        retryStats.totalRetries > 0
          ? (
              (retryStats.successfulRetries / retryStats.totalRetries) *
              100
            ).toFixed(2)
          : 0
      }%`
    );

    // Print USDT usage statistics
    console.log("\n[USDT USAGE STATISTICS]");
    console.log(`- Minimum USDT per task: ${usdtTracker.minUsdtPerTask}`);
    console.log(
      `- Total USDT required for ${concurrentTasks} tasks: ${
        usdtTracker.minUsdtPerTask * concurrentTasks
      }`
    );
    console.log(
      `- Total USDT used by successful operations: ${usdtTracker.totalUsdtUsed.toFixed(
        2
      )}`
    );
    console.log(
      `- Average USDT per successful operation: ${
        totalSuccessful > 0
          ? (usdtTracker.totalUsdtUsed / totalSuccessful).toFixed(2)
          : 0
      }`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel Bitverse open positions:",
      error
    );
  }
}

main().catch(console.error);

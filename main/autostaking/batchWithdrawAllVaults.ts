import * as dotenv from "dotenv";
import path from "path";
import {
  executeAllWalletsInParallel,
  executeWalletsWithConcurrency,
  executeWalletsMultipleTimes,
  executeWalletsInParallelMultipleTimes,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { failed } from "@scripts/utils/console";
import { assetUser } from "@scripts/pharosNetwork/autostaking/assetUser";
import { withdrawFromVault } from "@scripts/pharosNetwork/autostaking/withdraw";
import { router } from "@scripts/pharosNetwork/autostaking/contracts";
import { multicall } from "@scripts/pharosNetwork/autostaking/multicall";
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";

interface Vaults {
  address: string;
  balance: bigint;
}

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
 * Execute withdraw all vaults for a single wallet
 */
async function withdrawAllVaultsForWallet(
  wallet: WalletInstance,
  index: number,
  runCount: number = 0
) {
  try {
    console.log(
      `[${wallet.name}] Withdrawing all vaults from address: ${
        wallet.address
      } (Run ${runCount + 1})`
    );

    // Get the proxy URL and token
    const proxyUrl = wallet.proxy || process.env.PROXY_URL;
    const autoStakingToken =
      wallet.autoStakingToken || process.env.AUTOSTAKING_TOKEN;

    if (!proxyUrl || !autoStakingToken) {
      throw new Error(
        `PROXY_URL and AUTOSTAKING_TOKEN must be defined for wallet ${wallet.name}.`
      );
    }

    // Get user positions
    let asset: any;
    await executeWithRetry(async () => {
      const result = await assetUser({
        PROXY_URL: proxyUrl,
        AUTOSTAKING_TOKEN: autoStakingToken,
        walletAddress: wallet.address,
      });
      if (!result) {
        throw new Error("Error fetching asset data");
      }
      asset = result;
      return result;
    });

    if (!asset || !asset.data || !asset.data.positions) {
      throw new Error("Invalid asset data structure");
    }

    const positions = asset.data.positions;
    if (positions.length === 0) {
      console.log(`[${wallet.name}] No positions on any vault`);
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
        message: "No positions to withdraw",
      };
    }

    console.log(
      `[${wallet.name}] Found ${positions.length} positions to withdraw`
    );

    // Prepare all vault withdrawal data
    const vaults: Vaults[] = [];
    for (const position of positions) {
      vaults.push({
        address: position.assetAddress,
        balance: BigInt(position.assetBalance),
      });
    }

    const encodedArguments: string[] = [];
    for (const vault of vaults) {
      await executeWithRetry(async () => {
        const data = await withdrawFromVault({
          wallet: wallet.signer,
          vaultAddress: vault.address,
          router,
          amount: vault.balance,
        });
        if (data) encodedArguments.push(data);
        return data;
      });
    }

    console.log(
      `[${wallet.name}] Withdrawing from ${encodedArguments.length} vaults...`
    );

    // Execute multicall with retry
    await executeWithRetry(async () => {
      await multicall({
        wallet: wallet.signer,
        encodedArguments,
        router,
      });
      return true;
    });

    console.log(`[${wallet.name}] Successfully withdrawn from all vaults`);

    return {
      success: true,
      wallet: wallet.name,
      address: wallet.address,
      withdrawn: encodedArguments.length,
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
 * Main function to run parallel withdrawals for all wallets
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
        withdrawAllVaultsForWallet(wallet, index, runCount),
      runsPerWallet
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} withdrawals were successful`
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
      "[BATCH ERROR] Error running parallel withdrawals:",
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

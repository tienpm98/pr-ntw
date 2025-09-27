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
import { multicall } from "@scripts/pharosNetwork/autostaking/multicall";
import { advisor } from "@scripts/pharosNetwork/autostaking/advisor";
import { depositToVault } from "@scripts/pharosNetwork/autostaking/deposit";
import { tokenBalance } from "@scripts/utils/balance";
import { withdrawFromVault } from "@scripts/pharosNetwork/autostaking/withdraw";
import { sleep } from "@scripts/utils/time";
import { randomAmount } from "@scripts/utils/amount";

const router = "0x11cd3700b310339003641fdce57c1f9bd21ae015";
const baseDir = path.resolve(__dirname, "../../");

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

      if (error.code) {
        console.error(`Error code: ${error.code}`);
      }

      if (error.transaction) {
        console.error(
          `Transaction data: ${JSON.stringify({
            to: error.transaction.to,
            from: error.transaction.from,
            data: error.transaction.data?.substring(0, 50) + "...",
          })}`
        );
      }

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

interface VaultEntry {
  decimals: number;
  vaults: {
    vaultAddress: string;
    assetAddress: string;
    amount: bigint;
    type: string;
  }[];
}

/**
 * Perform AutoStaking deposit via advisor operations for a single wallet in parallel
 */
async function depositViaAdvisorForWallet(
  wallet: WalletInstance,
  index: number,
  runCount: number = 0
) {
  try {
    console.log(
      `[${
        wallet.name
      }] Starting AutoStaking deposit via advisor from address: ${
        wallet.address
      } (Run ${runCount + 1})`
    );

    // Get autoStakingToken from wallet config, fallback to process.env
    const autoStakingToken =
      wallet.autoStakingToken || process.env.AUTOSTAKING_TOKEN;

    if (!autoStakingToken) {
      throw new Error(`No AutoStaking token found for ${wallet.name}`);
    }

    console.log(
      `[${wallet.name}] Using AutoStaking token: ${autoStakingToken.substring(
        0,
        20
      )}...`
    );

    try {
      // Cấu hình môi trường tạm thời cho advisor API
      process.env.AUTOSTAKING_TOKEN = autoStakingToken;
      process.env.PROXY_URL = wallet.proxy || process.env.PROXY_URL || "";

      // Sử dụng retry cho advisor API call
      const response = await executeWithRetry(async () => {
        return await advisor({
          baseDir,
          wallet: wallet.signer,
          provider: wallet.signer.provider as any,
        });
      });
      if (!response) {
        console.log(`[${wallet.name}] Error fetch or access token not found!`);
        return {
          success: false,
          wallet: wallet.name,
          address: wallet.address,
          error: "Error fetch or access token not found",
        };
      }

      const encodedArguments: string[] = [];
      const changes = response?.data.data.changes;
      const groupedByToken: Record<string, VaultEntry> = {};

      for (const change of changes) {
        const tokenAddress = change.token.address.toLowerCase();

        if (!groupedByToken[tokenAddress]) {
          groupedByToken[tokenAddress] = {
            decimals: change.token.decimals,
            vaults: [],
          };
        }

        groupedByToken[tokenAddress].vaults.push({
          type: change.type,
          vaultAddress: change.product.address,
          assetAddress: change.product.asset.address,
          amount: BigInt(change.token.amount),
        });
      }

      for (const [tokenAddress, { vaults, decimals }] of Object.entries(
        groupedByToken
      )) {
        // Sử dụng retry cho tokenBalance
        const tokenBalanceResult = await executeWithRetry(async () => {
          return await tokenBalance({
            address: wallet.address,
            provider: wallet.signer.provider as any,
            tokenAddress,
          });
        });

        const tokenBalanceAmount = tokenBalanceResult.balance;

        const totalWeight = vaults.reduce((sum, v) => sum + v.amount, 0n);

        for (const v of vaults) {
          const proportion = Number(v.amount) / Number(totalWeight);
          const allocatedAmount = BigInt(
            Math.floor(Number(tokenBalanceAmount) * proportion)
          );
          let encoded: string | undefined;

          if (v.type === "deposit") {
            // Sử dụng retry cho depositToVault
            encoded = await executeWithRetry(async () => {
              return await depositToVault({
                wallet: wallet.signer,
                vaultAddress: v.vaultAddress,
                tokenAddress,
                amount: allocatedAmount,
                router,
              });
            });
          } else {
            // Sử dụng retry cho withdrawFromVault
            encoded = await executeWithRetry(async () => {
              return await withdrawFromVault({
                wallet: wallet.signer,
                vaultAddress: v.vaultAddress,
                router,
                amount: allocatedAmount,
              });
            });
          }

          encodedArguments.push(encoded!);
        }
      }

      console.log(`[${wallet.name}] Selected Tokens: `);
      console.dir(groupedByToken, { depth: null });

      // Kiểm tra xem có encoded arguments không trước khi thực hiện multicall
      if (encodedArguments.length === 0) {
        console.log(
          `[${wallet.name}] No encoded arguments to process. Skipping multicall.`
        );
        return {
          success: true,
          wallet: wallet.name,
          address: wallet.address,
          message: "No operations needed",
        };
      }

      // Log encoded arguments để debug
      console.log(
        `[${wallet.name}] Encoded arguments count: ${encodedArguments.length}`
      );

      // Kiểm tra gas trước khi gọi multicall
      try {
        console.log(`[${wallet.name}] Checking gas balance...`);
        const gasBalance = await wallet.signer.provider?.getBalance(
          wallet.address
        );
        console.log(`[${wallet.name}] Current gas balance: ${gasBalance} wei`);

        if (gasBalance && gasBalance < 1000000000000000n) {
          // 0.001 PHRS
          console.warn(
            `[${wallet.name}] Low gas balance. Transaction might fail.`
          );
        }
      } catch (error) {
        console.warn(`[${wallet.name}] Failed to check gas balance:`, error);
      }

      console.log(`[${wallet.name}] Depositing...`);

      // Thực hiện multicall với retry
      await executeWithRetry(
        async () => {
          // Kiểm tra và lọc các giá trị undefined hoặc null
          const validArgs = encodedArguments.filter((arg) => !!arg);

          if (validArgs.length === 0) {
            throw new Error("No valid encoded arguments for multicall");
          }

          return await multicall({
            wallet: wallet.signer,
            encodedArguments: validArgs,
            router,
          });
        },
        5,
        10000
      ); // Giảm số lần retry và tăng thời gian chờ

      console.log(`[${wallet.name}] Successfully deposited via advisor`);
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(
        `[${wallet.name}] Deposit failed: ${
          error instanceof Error ? error.message : error
        }`
      );
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
      };
    }
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
 * Main function to run parallel AutoStaking deposit via advisor for all wallets
 */
async function main() {
  try {
    // Load wallet configuration from wallets.json
    // Batch scripts sử dụng wallets từ wallets.json, không phải từ .env
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
        depositViaAdvisorForWallet(wallet, index, runCount),
      runsPerWallet
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} AutoStaking deposit via advisor operations were successful`
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
      "[BATCH ERROR] Error running parallel AutoStaking deposits:",
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

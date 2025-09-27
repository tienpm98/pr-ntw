import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { randomAmount } from "@scripts/utils/amount";
import { pharosTokenAddress } from "@scripts/lib/data";
import { swap } from "@scripts/pharosNetwork/faroswap/swap";

const baseDir = path.resolve(__dirname, "../");
const slippageUrl = "31.201";

/**
 * Perform Faroswap swap operations for a single wallet in parallel
 */
async function swapForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting Faroswap USDC swaps from address: ${wallet.address}`
    );

    const usdcAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDC"
    )[0].address;
    const usdtAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDT"
    )[0].address;

    // USDC -> USDT Swap
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    console.log(`[${wallet.name}] Swapping USDC -> USDT`);

    await swap({
      tokenIn: usdcAddress,
      tokenOut: usdtAddress,
      deadline,
      signer: wallet.signer,
      amountIn_inPercent: amountInPercent,
      provider: wallet.signer.provider as any,
      dirname: baseDir,
      slippageUrl,
    });

    console.log(`[${wallet.name}] Faroswap USDC swap completed successfully`);
    return {
      success: true,
      wallet: wallet.name,
      address: wallet.address,
    };
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
 * Main function to run parallel Faroswap USDC swaps for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute swaps for all wallets in parallel
    const startTime = Date.now();

    const results = await executeAllWalletsInParallel(
      walletManager,
      async (wallet, index) => swapForWallet(wallet, index, 50) // Use 50% for swaps
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} Faroswap USDC swap operations were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel Faroswap USDC swaps:",
      error
    );
  }
}

main().catch(console.error);

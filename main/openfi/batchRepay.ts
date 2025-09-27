import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { debtOpenFiAssets } from "@scripts/lib/data";
import { randomAmount } from "@scripts/utils/amount";
import { repay } from "@scripts/pharosNetwork/lendBorrowOpenfi/repay";

/**
 * Perform OpenFi repay operations for a single wallet in parallel
 */
async function repayForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting OpenFi repay from address: ${wallet.address}`
    );

    // Randomly select an asset to repay
    const indexAsset = Math.floor(
      randomAmount({
        min: 0,
        max: Number(debtOpenFiAssets.length - 1),
      })
    );

    const tokenAddress = debtOpenFiAssets[indexAsset].address;

    try {
      await repay({
        signer: wallet.signer,
        tokenAddress,
        amountInPercent,
        provider: wallet.signer.provider as any,
      });

      console.log(`[${wallet.name}] Successfully repaid to OpenFi`);
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(`[${wallet.name}] OpenFi repay failed: ${error}`);
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
 * Main function to run parallel OpenFi repay operations for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute repay operations for all wallets in parallel
    const startTime = Date.now();

    const results = await executeAllWalletsInParallel(
      walletManager,
      async (wallet, index) => repayForWallet(wallet, index, 50) // Use 50% for amount in percent
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} OpenFi repay operations were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel OpenFi repay operations:",
      error
    );
  }
}

main().catch(console.error);

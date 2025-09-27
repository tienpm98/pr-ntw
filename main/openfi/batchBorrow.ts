import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { openFiAssets } from "@scripts/lib/data";
import { randomAmount } from "@scripts/utils/amount";
import { borrow } from "@scripts/pharosNetwork/lendBorrowOpenfi/borrow";

/**
 * Perform OpenFi borrow operations for a single wallet in parallel
 */
async function borrowForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting OpenFi borrow from address: ${wallet.address}`
    );

    // Randomly select an asset to borrow
    const indexAsset = Math.floor(
      randomAmount({
        min: 0,
        max: Number(openFiAssets.length - 1),
      })
    );

    const tokenAddress = openFiAssets[indexAsset].address;

    try {
      await borrow({
        signer: wallet.signer,
        tokenAddress,
        amountInPercent,
        provider: wallet.signer.provider as any,
      });

      console.log(`[${wallet.name}] Successfully borrowed from OpenFi`);
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(`[${wallet.name}] OpenFi borrow failed: ${error}`);
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
 * Main function to run parallel OpenFi borrow operations for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute borrow operations for all wallets in parallel
    const startTime = Date.now();

    const results = await executeAllWalletsInParallel(
      walletManager,
      async (wallet, index) => borrowForWallet(wallet, index, 50) // Use 50% for amount in percent
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} OpenFi borrow operations were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel OpenFi borrow operations:",
      error
    );
  }
}

main().catch(console.error);

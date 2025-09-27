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
import { randomAmount } from "@scripts/utils/amount";
import { sleep } from "@scripts/utils/time";

/**
 * Perform Faroswap USDC liquidity operations for a single wallet in parallel
 */
async function usdcLiquidityForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting Faroswap USDC liquidity from address: ${wallet.address}`
    );

    const usdcAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDC"
    )[0].address;
    const wphrsAddress = pharosTokenAddress.filter(
      (item) => item.name == "WPHRS_FAROSWAP"
    )[0].address;
    const usdtAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDT"
    )[0].address;

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

        // Small delay between pools to avoid transaction collisions
        await sleep(2000);
      }

      // USDT/USDC pools
      poolAddresses = pharosPoolAddressPMMFaroswap.filter(
        (item) => item.pair == "USDT/USDC"
      )[0];

      for (let poolAddress of poolAddresses.address) {
        let deadline = Math.floor(Date.now() / 1000) + 60 * 10;
        console.log(
          `[${wallet.name}] Adding USDC/USDT liquidity to pool: ${poolAddress}`
        );

        await createLiquidity({
          poolAddress: poolAddress,
          tokenIn: usdcAddress,
          tokenOut: usdtAddress,
          deadline,
          signer: wallet.signer,
          amountIn_inPercent: amountInPercent,
          provider: wallet.signer.provider as any,
        });

        // Small delay between pools to avoid transaction collisions
        await sleep(2000);
      }

      console.log(
        `[${wallet.name}] Successfully added Faroswap USDC liquidity`
      );
      return {
        success: true,
        wallet: wallet.name,
        address: wallet.address,
      };
    } catch (error) {
      console.error(
        `[${wallet.name}] Faroswap USDC liquidity failed: ${error}`
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
 * Main function to run parallel Faroswap USDC liquidity operations for all wallets
 */
async function main() {
  try {
    // Load wallet configuration
    const configPath = path.resolve(__dirname, "../../config/wallets.json");
    const walletManager = loadWalletManager(configPath);

    console.log(`[BATCH MODE] Loaded ${walletManager.wallets.length} wallets.`);
    console.log(`Running all wallets in parallel (batch mode)`);

    // Execute liquidity operations for all wallets in parallel
    const startTime = Date.now();

    const results = await executeAllWalletsInParallel(
      walletManager,
      async (wallet, index) => usdcLiquidityForWallet(wallet, index, 50) // Use 50% for amount in percent
    );

    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // in seconds

    // Print summary
    const successful = results.filter((r) => r.success).length;
    console.log(
      `\n[BATCH SUMMARY] ${successful}/${results.length} Faroswap USDC liquidity operations were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel Faroswap USDC liquidity operations:",
      error
    );
  }
}

main().catch(console.error);

import path from "path";
import { failed } from "@scripts/utils/console";
import {
  executeAllWalletsInParallel,
  loadWalletManager,
  WalletInstance,
} from "@scripts/utils/batchWallet";
import { pharosTokenAddress, pharosPoolAddressZenith } from "@scripts/lib/data";
import { getPrice } from "@scripts/utils/price";
import { tokenBalance } from "@scripts/utils/balance";
import { multicall } from "@scripts/pharosNetwork/zenithFinance/swap";

const router = "0x1a4de519154ae51200b0ad7c90f7fac75547888a";

/**
 * Perform ZenithFinance swap operations for a single wallet in parallel
 */
async function swapForWallet(
  wallet: WalletInstance,
  index: number,
  amountInPercent: number = 50
) {
  try {
    console.log(
      `[${wallet.name}] Starting ZenithFinance USDC swaps from address: ${wallet.address}`
    );

    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
    const usdcAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDC"
    )[0].address;
    const usdtAddress = pharosTokenAddress.filter(
      (item) => item.name == "USDT"
    )[0].address;

    // USDC -> USDT Swap
    const poolAddressUsdcUsdt = pharosPoolAddressZenith.filter(
      (pool) => pool.pair == "USDC/USDT"
    )[0].address;

    // Get price info
    const priceUsdcToUsdt = await getPrice({
      poolAddress: poolAddressUsdcUsdt,
      addresses: {
        tokenA: usdcAddress,
        tokenB: usdtAddress,
      },
      provider: wallet.signer.provider as any,
    });

    // Get balance info
    let {
      balance: usdcBalance,
      symbol: usdcSymbol,
      decimals: usdcDecimals,
    } = await tokenBalance({
      address: wallet.address,
      provider: wallet.signer.provider as any,
      tokenAddress: usdcAddress,
    });

    const { symbol: usdtSymbol, decimals: usdtDecimals } = await tokenBalance({
      address: wallet.address,
      provider: wallet.signer.provider as any,
      tokenAddress: usdtAddress,
    });

    // Calculate swap amounts
    const slippageTolerance = 0.003;
    let priceScaled = BigInt(
      Math.floor(priceUsdcToUsdt.tokenAToTokenB * Number(10n ** usdtDecimals))
    );
    let amountIn = (usdcBalance * BigInt(amountInPercent)) / 100n;
    let amountOut =
      (amountIn *
        priceScaled *
        BigInt(1000 - Math.floor(slippageTolerance * 1000))) /
      (10n ** usdcDecimals * 1000n);

    console.log(`[${wallet.name}] SWAP ${usdcSymbol}/${usdtSymbol}`);
    try {
      console.log(`[${wallet.name}] Swapping...`);
      await multicall({
        router,
        tokenIn: usdcAddress,
        tokenOut: usdtAddress,
        amountIn,
        amountOut,
        fee: priceUsdcToUsdt.fee,
        signer: wallet.signer,
        deadline,
      });
    } catch (error) {
      console.error(`[${wallet.name}] Swap failed: ${error}`);
      return {
        success: false,
        wallet: wallet.name,
        address: wallet.address,
        error,
      };
    }

    console.log(
      `[${wallet.name}] ZenithFinance USDC swap completed successfully`
    );
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
 * Main function to run parallel ZenithFinance USDC swaps for all wallets
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
      `\n[BATCH SUMMARY] ${successful}/${results.length} ZenithFinance USDC swap operations were successful`
    );
    console.log(
      `[BATCH TIMING] Total execution time: ${executionTime.toFixed(2)} seconds`
    );
  } catch (error) {
    console.error(
      "[BATCH ERROR] Error running parallel ZenithFinance USDC swaps:",
      error
    );
  }
}

main().catch(console.error);

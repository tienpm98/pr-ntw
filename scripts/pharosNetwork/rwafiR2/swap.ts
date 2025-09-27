import { tokenBalance } from "@scripts/utils/balance";
import {
  Contract,
  JsonRpcProvider,
  toBeHex,
  Wallet,
  zeroPadValue,
  parseUnits,
} from "ethers";
import { approve } from "@scripts/utils/approve";
import { r2Abi } from "@scripts/lib/data";
import { success } from "@scripts/utils/console";

interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  router: string;
  signer: Wallet;
  provider: JsonRpcProvider;
  amountInPercent?: number;
  fixedAmount?: number; // New parameter for fixed amount
}

export async function swap({
  tokenIn,
  tokenOut,
  router,
  signer,
  provider,
  amountInPercent,
  fixedAmount,
}: SwapParams) {
  const {
    balance: tokenInBalance,
    symbol: tokenInSymbol,
    decimals: tokenInDecimals,
  } = await tokenBalance({
    address: signer.address,
    provider,
    tokenAddress: tokenIn,
  });
  const { symbol: tokenOutSymbol } = await tokenBalance({
    address: signer.address,
    provider,
    tokenAddress: tokenOut,
  });

  // Calculate amount based on whether we're using percentage or fixed amount
  let amountIn: bigint;
  if (fixedAmount !== undefined) {
    // Use fixed amount (convert to wei using token decimals)
    amountIn = parseUnits(fixedAmount.toString(), tokenInDecimals);
    console.log(`Using fixed amount: ${fixedAmount} ${tokenInSymbol}`);
  } else {
    // Use percentage (original logic)
    const percentToUse = amountInPercent || 50;
    amountIn = (tokenInBalance * BigInt(percentToUse)) / 100n;
    console.log(
      `Using ${percentToUse}% of balance: ${amountIn.toString()} ${tokenInSymbol}`
    );
  }

  if (tokenInBalance < amountIn) {
    console.log(
      `Insufficient ${tokenInSymbol}. Need: ${amountIn.toString()}, Have: ${tokenInBalance.toString()}`
    );
    return;
  }
  if (tokenIn.toLowerCase() == router.toLowerCase()) {
    console.log(`Swapping ${tokenInSymbol}/${tokenOutSymbol}...`);
    const routerContract = new Contract(router, r2Abi, signer);
    const tx = await routerContract.burn(signer.address, amountIn);
    await tx.wait();
    success({ hash: tx.hash });
  } else {
    await approve({
      tokenAddress: tokenIn,
      signer,
      router,
      amount: amountIn,
    });
    const selector = "0x095e7a95";
    const paddedAddress = zeroPadValue(signer.address, 32);
    const encodedZeroUint = zeroPadValue(toBeHex(0), 256);
    const paddedAmount = zeroPadValue(toBeHex(amountIn), 32);
    const callData =
      selector +
      paddedAddress.slice(2) +
      paddedAmount.slice(2) +
      encodedZeroUint.slice(2);
    console.log(`Swapping ${tokenInSymbol}/${tokenOutSymbol}...`);
    const tx = await signer.sendTransaction({
      to: router,
      data: callData,
    });
    await tx.wait();
    success({ hash: tx.hash });
  }
}

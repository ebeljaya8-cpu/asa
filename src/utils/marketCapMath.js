import { ethers } from 'ethers';

const Q96 = 2n ** 96n;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

// Fallback USD prices when live price feeds are unreachable
const FALLBACK_USD_PRICES = {
  ETH: 2050,
  WETH: 2050,
  HYPE: 25,
  USDC: 1,
  USDG: 1,
  USDT: 1
};

const _priceCache = new Map();
const PRICE_CACHE_TTL_MS = 60_000;

/**
 * Return standard Uniswap V3/V4 tickSpacing for a fee tier.
 */
export function getTickSpacingForFee(feeTier) {
  const f = Number(feeTier);
  if (f >= 10000) return 200;
  if (f >= 3000) return 60;
  if (f >= 500) return 10;
  return 1;
}

/**
 * Uniswap V3/V4 exact integer square root price ratio from tick.
 */
export function getSqrtRatioAtTick(tick) {
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > MAX_TICK) throw new Error(`Tick out of bounds: ${tick}`);

  let ratio = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990570e21b7n) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83a49184521n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf97957f9eed7efc0297058a9e7f41e57n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf2fa7a00f165e3fed864438df377a28cn) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe60b881308b29b400fb8e40f7d54ee4dn) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xcc9a4cb3e778401309f193eb778396cbn) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa3713f003b55584e0303112c3f87508an) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x6735e58c9735d6dbf4e91024840e69ben) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x2a9cb990053d2d20739945657ef928ebn) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x7181a0e60882362b66d3a8244f77c7an) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x3228d4924a3500d005697266febd11n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x9ef4e2f89633e9b1191029n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x9a444a56975a6n) >> 128n;

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;
  return (ratio >> 32n) + ((ratio % (1n << 32n)) === 0n ? 0n : 1n);
}

export function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
  if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  const intermediate = (sqrtRatioAX96 * sqrtRatioBX96) / Q96;
  return (amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96);
}

export function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
  if (sqrtRatioAX96 > sqrtRatioBX96) [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  return (amount1 * Q96) / (sqrtRatioBX96 - sqrtRatioAX96);
}

/**
 * Fetch live USD price of a quote symbol (ETH, WETH, HYPE, USDC, USDG).
 */
export async function fetchQuoteUsdPrice(quoteSymbol = 'ETH') {
  const sym = (quoteSymbol || 'ETH').toUpperCase().trim();
  if (['USDC', 'USDG', 'USDT', 'DAI', 'USDBC'].includes(sym)) return 1;

  const cached = _priceCache.get(sym);
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
    return cached.price;
  }

  const cgId = sym === 'HYPE' ? 'hyperliquid' : 'ethereum';
  try {
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`, { signal: AbortSignal.timeout(3500) });
    if (resp.ok) {
      const data = await resp.json();
      const usd = Number(data?.[cgId]?.usd);
      if (usd > 0) {
        _priceCache.set(sym, { price: usd, ts: Date.now() });
        return usd;
      }
    }
  } catch {}

  if (sym === 'ETH' || sym === 'WETH') {
    try {
      const resp = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { signal: AbortSignal.timeout(3500) });
      if (resp.ok) {
        const data = await resp.json();
        const usd = Number(data?.data?.amount);
        if (usd > 0) {
          _priceCache.set(sym, { price: usd, ts: Date.now() });
          return usd;
        }
      }
    } catch {}
  }

  return FALLBACK_USD_PRICES[sym] || 2050;
}

/**
 * Compute Clanker-style single-sided concentrated liquidity parameters for a target starting Market Cap (FDV in USD).
 * Only requires Token supply (`tokenLpWei`) with ZERO Quote asset needed for the LP itself.
 */
export function computeClankerMarketCapPosition({
  targetMarketCapUsd,
  quoteUsdPrice,
  totalSupplyWei,
  tokenDecimals = 18,
  quoteDecimals = 18,
  tokenAddress,
  quoteAddress,
  tokenLpWei,
  feeTier = 10000,
  maxMultiplier = 100000
}) {
  if (!targetMarketCapUsd || targetMarketCapUsd <= 0) {
    throw new Error('targetMarketCapUsd must be > 0');
  }
  if (!quoteUsdPrice || quoteUsdPrice <= 0) {
    throw new Error('quoteUsdPrice must be > 0');
  }

  const tickSpacing = getTickSpacingForFee(feeTier);
  const maxAlignedTick = Math.floor(887200 / tickSpacing) * tickSpacing;
  const minAlignedTick = -maxAlignedTick;

  const totalSupplyTokens = Number(ethers.formatUnits(totalSupplyWei, tokenDecimals));
  const mcapInQuote = Number(targetMarketCapUsd) / Number(quoteUsdPrice);
  const priceQuotePerTokenHuman = mcapInQuote / totalSupplyTokens;
  const decimalDiff = quoteDecimals - tokenDecimals;
  const priceQuotePerTokenRaw = priceQuotePerTokenHuman * (10 ** decimalDiff);

  const isToken0 = quoteAddress === ethers.ZeroAddress
    ? false
    : (BigInt(tokenAddress.toLowerCase()) < BigInt(quoteAddress.toLowerCase()));

  const currency0 = isToken0 ? tokenAddress : quoteAddress;
  const currency1 = isToken0 ? quoteAddress : tokenAddress;

  const ln10001 = Math.log(1.0001);
  let tickLower;
  let tickUpper;
  let sqrtPriceX96;
  let liquidity;
  let amount0Desired;
  let amount1Desired;
  let actualStartTick;

  if (isToken0) {
    // currency0 = Token, currency1 = Quote
    // Pool price = Quote_raw / Token_raw = priceQuotePerTokenRaw
    // Token-only position starts at tickLower (spA) and sells Token for Quote as price rises toward tickUpper.
    const rawStartTick = Math.log(priceQuotePerTokenRaw) / ln10001;
    const rawEndTick = Math.log(priceQuotePerTokenRaw * maxMultiplier) / ln10001;

    tickLower = Math.max(minAlignedTick, Math.floor(rawStartTick / tickSpacing) * tickSpacing);
    tickUpper = Math.min(maxAlignedTick, Math.ceil(rawEndTick / tickSpacing) * tickSpacing);
    if (tickUpper <= tickLower) tickUpper = Math.min(maxAlignedTick, tickLower + tickSpacing);

    const spA = getSqrtRatioAtTick(tickLower);
    const spB = getSqrtRatioAtTick(tickUpper);
    sqrtPriceX96 = spA;
    actualStartTick = tickLower;
    liquidity = getLiquidityForAmount0(spA, spB, tokenLpWei);
    amount0Desired = tokenLpWei;
    amount1Desired = 0n;
  } else {
    // currency0 = Quote, currency1 = Token (always true for Native ETH ZeroAddress)
    // Pool price = Token_raw / Quote_raw = 1 / priceQuotePerTokenRaw
    // Token-only position ends at tickUpper (spB) and sells Token for Quote as Token/Quote drops toward tickLower.
    const poolPriceStart = 1 / priceQuotePerTokenRaw;
    const poolPriceEnd = poolPriceStart / maxMultiplier;
    const rawStartTick = Math.log(poolPriceStart) / ln10001;
    const rawEndTick = Math.log(poolPriceEnd) / ln10001;

    tickUpper = Math.min(maxAlignedTick, Math.ceil(rawStartTick / tickSpacing) * tickSpacing);
    tickLower = Math.max(minAlignedTick, Math.floor(rawEndTick / tickSpacing) * tickSpacing);
    if (tickLower >= tickUpper) tickLower = Math.max(minAlignedTick, tickUpper - tickSpacing);

    const spA = getSqrtRatioAtTick(tickLower);
    const spB = getSqrtRatioAtTick(tickUpper);
    sqrtPriceX96 = spB;
    actualStartTick = tickUpper;
    liquidity = getLiquidityForAmount1(spA, spB, tokenLpWei);
    amount0Desired = 0n;
    amount1Desired = tokenLpWei;
  }

  // Compute realized starting price & FDV from aligned tick
  const realizedPoolPrice = 1.0001 ** actualStartTick;
  const realizedRawQuotePerToken = isToken0 ? realizedPoolPrice : (1 / realizedPoolPrice);
  const initialPriceQuotePerToken = realizedRawQuotePerToken / (10 ** decimalDiff);
  const initialMcapUsd = initialPriceQuotePerToken * totalSupplyTokens * Number(quoteUsdPrice);

  return {
    isToken0,
    currency0,
    currency1,
    tickLower,
    tickUpper,
    tickSpacing,
    sqrtPriceX96,
    liquidity,
    amount0Desired,
    amount1Desired,
    initialPriceQuotePerToken,
    initialMcapUsd
  };
}

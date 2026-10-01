// Plain-language definitions for the trading words the screens use. A word
// wrapped in Term() gets a dotted underline and opens its definition here.
export const GLOSSARY = /** @type {const} */ ({
  portfolio: 'Everything a Trader owns: its cash plus the shares it holds, valued at the latest closing prices.',
  cash: 'Money a Trader has not put into any stock. Holding cash is a choice too: it cannot fall, but it cannot grow either.',
  position: 'The shares a Trader holds in one stock or fund.',
  'position cap': 'The rule that no single stock may be more than a set share of a portfolio (20% to start), so nobody bets everything on one name.',
  return: 'How much a portfolio has gained or lost, as a percentage of what it started the period with.',
  'worst drop': 'The biggest fall from a high point to a later low, as a percentage. Traders call it the maximum drawdown. It shows how bumpy the ride was.',
  'the index': 'The Index buys SPY, a fund that holds the 500 biggest US companies, on day one and never trades. If a Trader cannot beat it, doing nothing would have been better.',
  'vs the index': 'A Trader\'s return minus The Index\'s return over the same dates. Above zero means it beat simply holding the market.',
  trimmed: 'The Compliance Desk cut an order down so it fits the rules, for example to keep a stock under the position cap.',
  'rule breaks': 'Orders the Compliance Desk had to trim or reject because they broke a rule.',
  'briefing pack': 'The one document every Trader reads before deciding: the day\'s prices, biggest moves and news headlines. The Floor Runner builds it after the close.',
  'at the open': 'Orders decided in the evening are filled at the next trading day\'s official opening price, the first price of the day.',
  etf: 'An exchange-traded fund: one share that holds a basket of many stocks or bonds, such as SPY for the S&P 500.',
  ticker: 'The short code a stock trades under, such as AAPL for Apple.',
  'cost basis': 'What a Trader paid in total for the shares it still holds.',
  'market view': 'The Trader\'s own summary of what the market did and what it thinks next, written with each decision.',
  journal: 'Private notes a Trader keeps for itself between runs. It reads them back before its next decision.',
  turnover: 'How much a Trader bought and sold in a day, as a share of its portfolio. High turnover means lots of trading.',
  'daily track': 'The four Traders that decide every evening.',
  'weekly track': 'The four Traders that decide once a week, after Friday\'s close. Same models, less trading.',
})

/** @typedef {keyof typeof GLOSSARY} GlossaryKey */

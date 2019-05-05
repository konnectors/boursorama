const moment = require('moment')
const rerrors = require('request-promise/errors')
const { log, errors } = require('cozy-konnector-libs')

const classification = require('../classification.json')

// ====== Constants =======

const defaultMedataOperation = {
  _id: '0',
  _proba: 0,
  _type: 'none'
}

const AccountType = {
  CHECKINGS: 'Checkings',
  SAVINGS: 'Savings',
  CARD: 'CreditCard',
  MARKET: 'Market',
  LIFE_INSURANCE: 'LifeInsurance'
}

const AbbrToAccountType = {
  cav: AccountType.CHECKINGS,
  livret: AccountType.SAVINGS,
  pel: AccountType.SAVINGS,
  cel: AccountType.SAVINGS,
  ldd: AccountType.SAVINGS,
  csljeune: AccountType.SAVINGS,
  ord: AccountType.MARKET,
  av: AccountType.LIFE_INSURANCE,
  'assurance-vie': AccountType.LIFE_INSURANCE,
  pea: AccountType.PEA,
  carte: AccountType.CARD
}

// ====== Public functions =======

/**
 * Convert string to {@link moment.Moment}
 * @param {string} date
 * @returns {moment.Moment}
 */
function parseDate(date) {
  moment.locale('fr')
  return moment(date, 'DD/MM/YYYY')
}

/**
 * Convert an amount to float
 * @param {string} amount
 * @returns {Number}
 */
function normalizeAmount(amount) {
  return parseFloat(
    amount
      .replaceAll(/\s/, '')
      .replace('"', '')
      .replace(',', '.')
      .trim()
  )
}

/**
 * Analyzes the URL of the bank account to find its type
 *
 * @param {string} url The URL of the bank account
 * @see {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankaccounts|io.cozy.bank.accounts}
 * @returns {string} The type of the bank account
 */
function getAccountTypeFromUrl(url) {
  let urlType = url.match(/\/compte\/([^/]+)\/[0-9a-f]+\/?(\w+)?\/?/)
  let type = urlType[2] || urlType[1]

  return AbbrToAccountType[type] || 'Unknown'
}

/**
 * Searches in the classification.json file, the metadata corresponding to words passed in parameters.
 * This function ignores the metadata dedicated to debit operations.
 *
 * @param {array} words
 * @returns {object}
 */
function findMetadataForCreditOperation(words) {
  return _classification(words, defaultMedataOperation, (tree, metadata) =>
    _readSpecificMetaData(tree, '_credit', metadata)
  )
}

/**
 * Searches in the classification.json file, the metadata corresponding to words passed in parameters.
 * This function ignores the metadata dedicated to credit operations.
 *
 * @param {array} words
 * @returns {object}
 */
function findMetadataForDebitOperation(words) {
  return _classification(words, defaultMedataOperation, (tree, metadata) =>
    _readSpecificMetaData(tree, '_debit', metadata)
  )
}

/**
 *
 * @param err
 * @returns {Promise.<*>}
 */
function handleRequestErrors(err) {
  if (
    err instanceof rerrors.RequestError ||
    err instanceof rerrors.StatusCodeError
  ) {
    log('error', err)
    throw new Error(errors.VENDOR_DOWN)
  } else {
    return Promise.reject(err)
  }
}

// ====== Private functions =======

function _classification(words, metadata, fnReadMetadata) {
  let treeActive = classification[words[0].toUpperCase()]
  if (!treeActive) {
    return metadata
  }

  let index = words[0] === 'CARTE' ? 2 : 1

  fnReadMetadata(treeActive, metadata)

  for (let word of words.slice(index)) {
    let tree = treeActive[word.toUpperCase()]

    if (!tree) {
      return metadata
    }

    fnReadMetadata(tree, metadata)
    treeActive = tree
  }
}

function _readDefaultMetaData(treeMetadata, metadata) {
  Object.keys(metadata).forEach(key => {
    if (treeMetadata[key]) metadata[key] = treeMetadata[key]
  })
}

function _readSpecificMetaData(treeMetadata, typeOperation, metadata) {
  _readDefaultMetaData(treeMetadata, metadata)

  if (treeMetadata[typeOperation]) {
    _readDefaultMetaData(treeMetadata[typeOperation], metadata)
  }
  return metadata
}

// ====== Export =======

module.exports = {
  parseDate,
  normalizeAmount,
  handleRequestErrors,
  getAccountTypeFromUrl,
  findMetadataForCreditOperation,
  findMetadataForDebitOperation
}

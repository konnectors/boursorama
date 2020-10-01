const {
  requestFactory,
  updateOrCreate,
  log,
  scrape,
  errors,
  categorize,
  cozyClient
} = require('cozy-konnector-libs')

const groupBy = require('lodash/groupBy')
const omit = require('lodash/omit')
const moment = require('moment')

const helpers = require('./helpers')
const keypad = require('./keypad')

const doctypes = require('cozy-doctypes')
const {
  Document,
  BankAccount,
  BankTransaction,
  BalanceHistory,
  BankingReconciliator
} = doctypes

// ------

const baseUrl = 'https://clients.boursorama.com'
const urlLogin = baseUrl + '/connexion/saisie-mot-de-passe'
const urlKeyboard = baseUrl + '/connexion/clavier-virtuel?_hinclude=1'
const urlDownload = baseUrl + '/mon-budget/exporter-mouvements'
const urlAccounts =
  baseUrl + '/dashboard/comptes?rumroute=dashboard.accounts&_hinclude=1'

Document.registerClient(cozyClient)

const reconciliator = new BankingReconciliator({ BankAccount, BankTransaction })
const request = requestFactory({
  //debug: 'full',
  cheerio: true,
  json: false,
  jar: true
})

let lib

/**
 * The start function is run by the BaseKonnector instance only when it got all the account
 * information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
 * the account information come from ./konnector-dev-config.json file
 * @param {object} fields
 */
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Get bank accounts list')
  let $ = await request({ uri: urlAccounts })

  log('info', 'Parsing list of bank accounts')
  const bankAccounts = await lib.parseBankAccounts($)

  log('info', 'Retrieve all informations for each bank accounts found')

  const today = moment().format('YYYY-MM-DD')
  const tenYearsAgo = moment()
    .subtract(10, 'years')
    .format('YYYY-MM-DD')

  let allOperations = []
  for (let bankAccount of bankAccounts) {
    log('info', 'Download CSV', 'bank.operations')
    let csv = await downloadCSVWithBankInformation(
      tenYearsAgo,
      today,
      bankAccount
    )

    if (csv) {
      log('info', 'Parse operations', 'bank.operations')
      allOperations = allOperations.concat(
        lib.parseOperations(bankAccount, csv)
      )
    } else {
      log('info', 'No operations', 'bank.operations')
    }
  }

  log('info', 'Categorize the list of transactions')
  const categorizedTransactions = await categorize(allOperations)

  const { accounts: savedAccounts } = await reconciliator.save(
    bankAccounts.map(x =>
      omit(x, [
        'currency',
        'typeAccount',
        'link',
        'children',
        'idAccountParent',
        'idAccount'
      ])
    ),
    categorizedTransactions
  )

  log(
    'info',
    'Retrieve the balance histories and adds the balance of the day for each bank accounts'
  )
  const balances = await fetchBalances(savedAccounts)

  log('info', 'Save the balance histories')
  await lib.saveBalances(balances)
}

/**
 * This function initiates a connection on the Boursorama website.
 *
 * @param {string} login
 * @param {string} passwd Password
 * @see {@link https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin}
 * @returns {boolean} Returns true if authentication is successful, else false
 */

function authenticate(login, passwd) {
  let formData = {
    'form[clientNumber]': login,
    'form[password]': '',
    'form[matrixRandomChallenge]': ''
  }

  return request({
    uri: urlLogin
  })
    .then(() => {
      return request({
        uri: urlKeyboard
      })
    })
    .then($ => {
      // Retrieve the challenge
      let regexChallenge = /val\("(.+)"\)/g
      let challengeFound = regexChallenge.exec($('script').html())

      if (!challengeFound) throw new Error(errors.CAPTCHA_RESOLUTION_FAILED)

      formData['form[matrixRandomChallenge]'] = challengeFound[1]
      return Promise.all(keypad.getPassword($, passwd))
    })
    .then(passwordEncrypt => {
      formData['form[password]'] = passwordEncrypt.join('|')

      return request({
        uri: urlLogin,
        method: 'POST',
        form: formData
      })
    })
    .then($ => {
      if ($('a[href="/se-deconnecter"]').length) {
        log('info', 'LOGIN_OK')
        return $
      } else {
        throw new Error(errors.LOGIN_FAILED)
      }
    })
}

/**
 * Downloads an CSV file with the transactions registered during the selected period for
 * an bank account.
 *
 * @returns {array} The lines of the CSV file
 */
function downloadCSVWithBankInformation(fromDate, toDate, bankAccount) {
  const rq = requestFactory({
    //debug: 'full',
    cheerio: false,
    gzip: false,
    jar: true
  })

  let formData = [
    'movementSearch[realtime]=0',
    'movementSearch[removeExcludeFromBudget]=1',
    'movementSearch[fromDate]=' + fromDate,
    'movementSearch[toDate]=' + toDate,
    'movementSearch[accounts][0]=' + bankAccount.idAccount
  ]

  return rq({
    uri: urlDownload + '?' + encodeURI(formData.join('&')),
    encoding: 'binary'
  })
    .then(csv => {
      return csv ? csv.split('\n') : null
    })
    .catch(helpers.handleRequestErrors)
}

/**
 * Retrieves all the bank accounts of the user from HTML.
 *
 * @param {object} $ DOM parsed by {@link https://cheerio.js.org/|Cheerio}
 * @see {@link https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape}
 *
 * @example
 * parseBankAccounts($);
 *
 * // [
 * //   {
 * //     institutionLabel: 'Boursorama Banque',
 * //     label: 'LIVRET',
 * //     type: 'Savings',
 * //     balance: 42,
 * //     idAccount: 'l42...',
 * //     currency: 'EUR'
 * //   }
 * // ]
 *
 * @returns {array} Collection of
 * {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankaccounts|io.cozy.bank.accounts}
 */
async function parseBankAccounts($) {
  const accounts = scrape(
    $,
    {
      idAccount: {
        sel: 'a',
        attr: 'href',
        parse: href =>
          href
            .split('/')
            .filter(i => i.length > 0)
            .pop()
      },
      label: {
        sel: 'a.account--name',
        fn: $node => {
          let $children = $node.children()
          return $children.length
            ? $children.text()
            : $node
                .text()
                .replaceAll('\\n', '')
                .trim()
        },
        parse: body => body.toUpperCase()
      },
      balance: {
        sel: 'a.account--balance',
        parse: helpers.normalizeAmount
      },
      type: {
        sel: 'a.account--name',
        attr: 'href',
        parse: helpers.getAccountTypeFromUrl
      },
      url: {
        sel: 'a.account--name',
        attr: 'href',
        parse: href => baseUrl + href
      }
    },
    'table.table--accounts tr.table__line--account'
  )

  for (let account of accounts) {
    account.institutionLabel = 'Boursorama Banque'
    account.currency = 'EUR'

    if (account.type == helpers.AbbrToAccountType['carte']) {
      // Ignore this step for the card account
      continue
    }

    const $ = await request({ uri: account.url })
    const number = scrape($('h3.account-number'), {
      reference: {
        sel: 'strong'
      }
    })
    account.number = number.reference
    account.vendorId = number.reference
  }

  return accounts.map(x => omit(x, ['url']))
}

/**
 * Parses and transforms each lines (CSV format) into
 * {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankoperations|io.cozy.bank.operations}
 * @param {io.cozy.bank.accounts} account Bank account
 * @param {array} operationLines Lines containing operation information for the current bank account - CSV format expected
 *
 * @example
 * var account = {
 *    institutionLabel: 'Boursorama Banque',
 *    label: 'LIVRET',
 *    type: 'Savings',
 *    balance: 42,
 *    idAccount: 'l42...',
 *    accountType: 4,
 *    currency: 'EUR'
 * };
 *
 * var csv = [
 *    'dateOp;dateVal;label;category;categoryParent;supplierFound;amount;accountNum;accountLabel;accountBalance', // ignored
 *    // Transaction(s)
 *    '31/12/18;01/01/19;"INTERETS 2018";"...";"...";"...";38,67;XXXXXXXX;"...";42',
 * ];
 *
 * parseOperations(account, csv);
 * // [
 * //   {
 * //     label: 'INTERETS 2018',
 * //     type: 'direct debit',
 * //     cozyCategoryId: '200130',
 * //     cozyCategoryProba: 1,
 * //     date: "2018-12-30T23:00:00+01:00",
 * //     dateOperation: "2018-12-31T23:00:00+01:00",
 * //     dateImport: "2019-04-17T10:07:30.553Z",     (UTC)
 * //     currency: 'EUR',
 * //     vendorAccountId: 'XXXXXXXX',
 * //     amount: 38.67,
 * //     vendorId: 'XXXXXXXX_2018-12-30_0'           {number}_{date}_{index}
 * //   }
 *
 * @returns {array} Collection of {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankoperations|io.cozy.bank.operations}.
 */
function parseOperations(account, operationLines) {
  let isCreditCard = account.type == helpers.AbbrToAccountType['carte']

  const operations = operationLines
    .slice(1)
    .filter(line => {
      return line.length > 5 // avoid lines with empty cells
    })
    .map(line => {
      let cells = line.split(';')
      let label = cells[2].replaceAll(/^"|"$/, '')

      const words = label.split(' ')
      let metadata = null

      const date = helpers.parseDate(cells[0])
      const dateOperation = helpers.parseDate(cells[1])

      let amount = helpers.normalizeAmount(cells[6])
      if (amount < 0) {
        metadata = helpers.findMetadataForDebitOperation(words)
      } else if (amount >= 0) {
        metadata = helpers.findMetadataForCreditOperation(words)
      } else {
        log('error', cells, 'Could not find an amount in this operation')
      }

      return {
        label: label,
        type: metadata._type || 'none',
        date: date.format(),
        dateOperation: dateOperation.format(),
        dateImport: new Date().toISOString(),
        currency: account.currency,
        vendorAccountId: isCreditCard ? cells[7] : account.number, // cells[7] = bank account number
        amount: amount
      }
    })

  if (isCreditCard) {
    account.number = operations[0].vendorAccountId
    account.vendorId = operations[0].vendorAccountId
  }

  // Forge a vendorId by concatenating account number, day YYYY-MM-DD and index
  // of the operation during the day
  const groups = groupBy(operations, x => x.date.slice(0, 10))
  Object.entries(groups).forEach(([date, group]) => {
    group.forEach((operation, i) => {
      operation.vendorId = `${account.vendorId.replaceAll(
        /\s/,
        '_'
      )}_${date}_${i}`
    })
  })

  return operations
}

/**
 * Retrieves the balance histories of each bank accounts and adds the balance of the day for each bank account.
 * @param {array} accounts Collection of {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankaccounts|io.cozy.bank.accounts}
 * already registered in database
 *
 * @example
 * var accounts = [
 *    {
 *      _id: '12345...',
 *      _rev: '14-98765...',
 *      _type: 'io.cozy.bank.accounts',
 *      balance: 42,
 *      cozyMetadata: { updatedAt: '2019-04-17T10:07:30.769Z' },
 *      institutionLabel: 'Boursorama Banque',
 *      label: 'LIVRET',
 *      number: 'XXXXXXXX',
 *      rawNumber: 'XXXXXXXX',
 *      type: 'Savings',
 *      vendorId: 'XXXXXXXX'
 *    }
 * ];
 *
 *
 * fetchBalances(accounts);
 *
 * // [
 * //   {
 * //     _id: '12345...',
 * //     _rev: '9-98765...',
 * //     balances: { '2019-04-16': 42, '2019-04-17': 42 },
 * //     metadata: { version: 1 },
 * //     relationships: { account: [Object] },
 * //     year: 2019
 * //   }
 * // ]
 *
 * @returns {array} Collection of {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankbalancehistories|io.cozy.bank.balancehistories}
 * registered in database
 */
function fetchBalances(accounts) {
  const now = moment()
  const todayAsString = now.format('YYYY-MM-DD')
  const currentYear = now.year()

  return Promise.all(
    accounts.map(async account => {
      const history = await BalanceHistory.getByYearAndAccount(
        currentYear,
        account._id
      )
      history.balances[todayAsString] = account.balance

      return history
    })
  )
}

/**
 * Saves the balance histories in database.
 *
 * @param balances Collection of {@link https://docs.cozy.io/en/cozy-doctypes/docs/io.cozy.bank/#iocozybankbalancehistories|io.cozy.bank.balancehistories}
 * to save in database
 * @returns {Promise}
 */
function saveBalances(balances) {
  return updateOrCreate(balances, 'io.cozy.bank.balancehistories', ['_id'])
}

// ===== Export ======

String.prototype.replaceAll = function(search, replacement) {
  var target = this
  return target.replace(new RegExp(search, 'g'), replacement)
}

module.exports = lib = {
  start,
  authenticate,
  parseBankAccounts,
  parseOperations,
  fetchBalances,
  saveBalances
}

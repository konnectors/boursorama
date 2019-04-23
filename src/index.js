const { BaseKonnector } = require('cozy-konnector-libs')
const { start } = require('./lib')

module.exports = new BaseKonnector(start)

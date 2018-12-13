const Joi = require('joi');
const {log} = require('./logging')
const {BaseError} = require('make-error-cause')

class ConfigurationError extends BaseError {
  constructor (message, cause) {
    super(message, cause)
  }
}

const configSchema = Joi.object().required().keys({
  factomdConfig: Joi.object().required().keys({
    host: Joi.string().hostname().default('localhost').required(),
    port: Joi.number().port().default(8088).required(),
  }),
  addresses: Joi.array().required().min(1).items(Joi.object({
    address: Joi.string().regex(/^FA[A-Za-z0-9]{50}$/).required(),
    bitcoinTaxKey: Joi.string().alphanum().allow(''),
    bitcoinTaxSecret: Joi.string().alphanum().allow(''),
    currency: Joi.string().required(),
    nickname: Joi.string().required(),
    recordCoinbaseReceipts: Joi.boolean().default(true),
    recordNonCoinbaseReceipts: Joi.boolean().default(false),
    saveToBitcoinTax: Joi.boolean().default(false),
    saveToCsv: Joi.boolean().default(true),
  })),
  logging: Joi.object().default().keys({
    papertrail: Joi.object().default().keys({
      enabled: Joi.boolean().default(false),
      host: Joi.string().hostname().when('enabled', {
        is: true,
        then: Joi.required(),
      }),
      port: Joi.number().port().when('enabled', {
        is: true,
        then: Joi.required(),
      }),
    }),
    stackdriver: Joi.object().default().keys({
      enabled: Joi.boolean().default(false),
    })
  }),
})

let config = null

const validateConfig = () => {
  const unvalidatedConfig = require('../conf/config.json')

  return Joi.validate(
    unvalidatedConfig,
    configSchema,
    (validationError, validatedConfig) => {
      if (validationError) {
        throw validationError
      }

      config = validatedConfig
      log.info('Configuration successfully read')
      return validatedConfig
    }
  )
}

const getConfig = () => {
  if (!config) {
    throw new ConfigurationError('config.json has not been validated!')
  }

  return config
}

module.exports = {validateConfig, getConfig}

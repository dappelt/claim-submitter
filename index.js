'use strict'

const { RippleAPI } = require('ripple-lib')
const rippleKeypairs = require('ripple-keypairs')
const BigNumber = require('bignumber.js')
const debug = require('debug')('claim-submitter')

// Generates a keypair for a paychan
function generateKeypair (secret, peerAddress) {
  const seed = rippleKeypairs.generateSeed(hmac(secret, 'CHANNEL_KEY:' + peerAddress))
  return deriveKeypair(seed)
}
const dropsToXrp = (drops) => new BigNumber(drops).div(dropsPerXrp).toString()

const SUBMIT_INTERVAL = 10000

class ClaimSubmitter {
  
  constructor (opts) {
    this.rippledServer = opts.rippledServer
    this.api = new RippleAPI({ server: opts.rippledServer })
    this.address = opts.address
    this.paymentChannelId = opts.paymentChannelId
    this.secret = opts.secret
    this.peerAddress = opts.peerAddress
    this.submittedClaim = opts.submittedClaim || { amount: 0, signature: '' }
  }

  async _connect () {
    await this.api.connect(this.rippledServer)
  }

  async _submit (amount, signature) {
    if (!this.api.isConnected) await _connect()

    const tx = await this.api.preparePaymentChannelClaim(this.address, {
      balance: dropsToXrp(amount),
      channel: this.paymentChannelId,
      signature: signature.toUpperCase(),
    })

    const signedTx = this.api.sign(tx.txJSON, this.secret)
    debug('submitting claim transaction ', tx)
    const {resultCode, resultMessage} = await this.api.submit(signedTx.signedTransaction)
    if (resultCode !== 'tesSUCCESS') {
      debug('Error submitting claim: ', resultMessage)
      throw new Error('Could not claim funds: ', resultMessage)
    }

    return new Promise((resolve) => {
      const handleTransaction = function (ev) {
        if (ev.transaction.Account !== this.address) return
        if (ev.transaction.Channel !== this.paymentChannelId) return
        if (ev.transaction.Balance !== amount) return

        if (ev.engine_result === 'tesSUCCESS') {
          debug('successfully submitted claim', signature, 'for amount', amount)
        } else {
          debug('claiming funds failed ', ev)
        }

        setImmediate(() => this.api.connection
          .removeListener('transaction', handleTransaction))
        resolve()
      }

      this.api.connection.on('transaction', handleTransaction)
    })
  }

  // TODO: add logic to read claims from DB or file or ...
  async _readBestClaim () {

  }

  async start () {
    this.intervalId = setInterval(() => {
      const bestClaim = _readBestClaim()
      const isBetter = new BigNumber(bestClaim.amount)
        .greaterThan(this.submittedClaim.amount)

      if (isBetter) {
        try {
          await _submit(bestClaim.amount, bestClaim.signature)
          this.submittedClaim = bestClaim
        } catch (err) {
          debug('Error submitting claim', err)
        }
      }
    }, SUBMIT_INTERVAL)
  }

  stop () {
    clearInterval(this.intervalId)
  }
}

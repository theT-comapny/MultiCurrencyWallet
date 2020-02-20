import React, { Fragment } from 'react'
import PropTypes from 'prop-types'
import helpers, { constants } from 'helpers'
import actions from 'redux/actions'
import Link from 'sw-valuelink'
import { connect } from 'redaction'
import config from 'app-config'

import cssModules from 'react-css-modules'
import styles from '../WithdrawModal/WithdrawModal.scss'

import { BigNumber } from 'bignumber.js'
import Modal from 'components/modal/Modal/Modal'
import FieldLabel from 'components/forms/FieldLabel/FieldLabel'
import Input from 'components/forms/Input/Input'
import Button from 'components/controls/Button/Button'
import Tooltip from 'components/ui/Tooltip/Tooltip'
import { FormattedMessage, injectIntl, defineMessages } from 'react-intl'
import ReactTooltip from 'react-tooltip'
import { isMobile } from 'react-device-detect'
import InvoiceInfoBlock from 'components/InvoiceInfoBlock/InvoiceInfoBlock'

import typeforce from 'swap.app/util/typeforce'
// import { isCoinAddress } from 'swap.app/util/typeforce'
import minAmount from 'helpers/constants/minAmount'
import { inputReplaceCommaWithDot } from 'helpers/domUtils'
import QrReader from "components/QrReader";


@injectIntl
@connect(
  ({
    currencies,
    user: {
      btcData,
      btcMultisigSMSData,
    },
  }) => ({
    currencies: currencies.items,
    items: [btcData, btcMultisigSMSData],
  })
)
@cssModules(styles, { allowMultiple: true })
export default class WithdrawModalMultisig extends React.Component {

  static propTypes = {
    name: PropTypes.string,
    data: PropTypes.object,
  }

  constructor(data) {
    super()

    const {
      data: {
        amount,
        toAddress,
        currency
      },
      items,
    } = data

    const currentDecimals = constants.tokenDecimals.btcmultisig
    const selectedItem = items.filter(item => item.currency === currency)[0]

    this.state = {
      step: 'fillform',
      isShipped: false,
      address: (toAddress) ? toAddress : '',
      amount: (amount) ? amount : '',
      code: '',
      minus: '',
      balance: selectedItem.balance || 0,
      ethBalance: null,
      isEthToken: false,
      currentDecimals,
      getUsd: 0,
      error: false,
      smsConfirmed: false,
      ownTx: '',
      mnemonic: '',
      broadcastError: false,
      sendSmsTimeout: 0,
      sendSmsTimeoutTimer: false,
    }
  }

  componentWillUnmount() {
    clearInterval(this.state.sendSmsTimeoutTimer)
  }

  gotoSms = () => {
    this.setState({
      smsStatus: 'sended',
      step: 'confirm',
    })
  }

  componentDidMount() {
    const { exCurrencyRate } = this.state
    const { data: { currency } } = this.props

    this.setBalanceOnState(currency)

    this.usdRates = {}
    this.getUsdBalance()
    this.actualyMinAmount()
    //this.gotoSms()
  }

  getMinAmountForEthToken = () => {
    const { data: { currency } } = this.props
    const { currentDecimals } = this.state

    let ethTokenMinAmount = '0.'

    for (let a = 0; a < currentDecimals - 1; a++) {
      ethTokenMinAmount += '0'
    }

    return ethTokenMinAmount += '1'
  }

  actualyMinAmount = async () => {
    const { data: { currency } } = this.props
    const { isEthToken } = this.state

    const currentCoin = currency.toLowerCase()

    if (isEthToken) {
      minAmount[currentCoin] = this.getMinAmountForEthToken()
      minAmount.eth = await helpers.eth.estimateFeeValue({ method: 'send', speed: 'fast' })
    }

    if (constants.coinsWithDynamicFee.includes(currentCoin)) {
      minAmount[currentCoin] = await helpers[currentCoin].estimateFeeValue({ method: 'send', speed: 'fast' })
    }
  }

  setBalanceOnState = async (currency) => {
    const { data: { unconfirmedBalance } } = this.props

    const balance = await actions.btcmultisig.getBalance()

    const finalBalance = unconfirmedBalance !== undefined && unconfirmedBalance < 0
      ? new BigNumber(balance).plus(unconfirmedBalance).toString()
      : balance
    const ethBalance = await actions.eth.getBalance()

    this.setState(() => ({
      balance: finalBalance,
      ethBalance,
    }))
  }

  getUsdBalance = async () => {
    const { data: { currency } } = this.props

    const exCurrencyRate = await actions.user.getExchangeRate(currency, 'usd')

    this.usdRates[currency] = exCurrencyRate

    this.setState(() => ({
      exCurrencyRate,
    }))
  }

  onFinishWithdraw = async (txId) => {
    const {
      amount,
      to,
    } = this.state

    const {
      data: {
        currency,
        address,
        balance,
        invoice,
        onReady
      },
      name,
    } = this.props

    actions.loader.hide();

    if (invoice) {
      await actions.invoices.markInvoice(invoice.id, "ready", txId);
    }
    this.setBalanceOnState(currency)

    actions.modals.open(constants.modals.InfoPay, {
      amount,
      currency,
      txId,
      address: to
    })

    this.setState({
      isShipped: false,
      error: false,
    })

    if (onReady instanceof Function) {
      onReady()
    }
    actions.modals.close(name)
  }

  handleConfirmSMS = async () => {
    const { code } = this.state
    const { address: to, amount } = this.state
    const { data: { currency, address, balance, invoice, onReady }, name } = this.props

    const result = await actions.btcmultisig.confirmSMSProtected(code)
    if (result && result.txID) {
      this.onFinishWithdraw( txID )
    } else {
      console.log(result)
      if (result
        && result.error
        && (result.error == 'Fail broadcast')
        && result.rawTX
      ) {
        actions.btc.broadcastTx( result.rawTX ).then(async ({ txid }) => {
          if (txid) {
            this.onFinishWithdraw( txid )
          } else {
            this.setState({
              broadcastError: true,
              rawTx: rawTX,
              isShipped: false,
              error: <FormattedMessage id="WithdrawSMS_BroadcastError" defaultMessage="Не удалось отправить транзакцию в сеть ({errorText})"  values={{ errorText: `unknown` }} />,
            })
          }
        })
      }
    }
  }

  handleSubmit = async () => {
    const {
      address: to,
      amount,
      ownTx,
      rawTx,
    } = this.state

    const {
      data: {
        currency,
        address,
        balance,
        invoice,
        onReady,
      },
      name,
    } = this.props

    this.setState(() => ({
      isShipped: true,
      step: 'confirm',
    }))

    this.setBalanceOnState(currency)

    if (invoice && ownTx) {
      await actions.invoices.markInvoice(invoice.id, 'ready', ownTx)
      actions.loader.hide()
      actions.notifications.show(constants.notifications.SuccessWithdraw, {
        amount,
        currency,
        address: to,
      })
      this.setState(() => ({ isShipped: false, error: false }))
      actions.modals.close(name)
      if (onReady instanceof Function) {
        onReady()
      }
      return
    }

    let sendOptions = {
      to,
      amount,
      speed: 'fast',
      from: address,
    }

    this.setState({
      sendSmsStatus: 'sending',
    })

    const result = await actions.btcmultisig.sendSMSProtected(sendOptions)

    console.log('sendSMSProtected result', result)
    if (result && result.answer === 'ok') {
      this.setState({
        isShipped: false,
        rawTx: (result.rawTx) ? result.rawTx : rawTx,
        sendSmsStatus: 'sended',
      })
    } else {
      this.setState({
        isShipped: false,
        sendSmsStatus: 'offline',
        rawTx: (result.rawTx) ? result.rawTx : rawTx,
      })
    }
  }

  sellAllBalance = async () => {
    const { amount, balance, currency, isEthToken } = this.state
    const { data } = this.props

    const minFee = minAmount.btc

    const balanceMiner = balance
      ? balance !== 0
        ? new BigNumber(balance).minus(minFee).toString()
        : balance
      : 'Wait please. Loading...'

    this.setState({
      amount: balanceMiner,
    })
  }

  isEthOrERC20() {
    const { name, data, tokenItems } = this.props
    const { currency, ethBalance, isEthToken } = this.state
    return (
      (isEthToken === true && ethBalance < minAmount.eth) ? ethBalance < minAmount.eth : false
    )
  }

  openScan = () => {
    const { openScanCam } = this.state;

    this.setState(() => ({
      openScanCam: !openScanCam
    }));
  };

  handleMnemonicSign = () => {
    const {
      mnemonic,
      rawTx,
      balance,
      amount,
      to,
    } = this.state

    if (!mnemonic || !actions.btc.validateMnemonicWords(mnemonic)) {
      this.setState({
        error: <FormattedMessage id='WithdrawSMS_NotValidMnemonic' defaultMessage='Секретная фраза не валидна' />,
      })
      return
    }
    if (!actions.btcmultisig.checkSmsMnemonic( mnemonic )) {
      this.setState({
        error: <FormattedMessage id='WithdrawSMS_WrongMnemonic' defaultMessage='Не правильная секретная фраза' />,
      })
      return
    }

    this.setState({
      isShipped: true,
      error: false,
      broadcastError: false,
    })

    actions.btcmultisig.signSmsMnemonicAndBuild( rawTx, mnemonic ).then(async ( txHex ) => {
      console.log('signed', txHex)
      this.setState({
        txHex,
      })
      actions.btc.broadcastTx( txHex ).then(async ({ txid }) => {
        if (txid) {
          this.onFinishWithdraw( txid )
        } else {
          this.setState({
            broadcastError: true,
            isShipped: false,
            error: <FormattedMessage id="WithdrawSMS_BroadcastError" defaultMessage="Не удалось отправить транзакцию в сеть ({errorText})"  values={{ errorText: `unknown` }} />,
          })
        }
      })
      .catch((e) => {
        console.error(e)
        const errorText = e.res ? e.res.text : e.message;
        this.setState({
          broadcastError: true,
          isShipped: false,
          error: <FormattedMessage id="WithdrawSMS_BroadcastError" defaultMessage="Не удалось отправить транзакцию в сеть ({errorText})" values={{ errorText }} />,
        })
      })
    })
    .catch((e) => {
      console.log('fail sign tx by mnemonic')
      this.setState({
        isShipped: false,
        error: <FormattedMessage id="WithdrawSMS_FailSignByMnemonic" defaultMessage="Не удалось подписать транзакцию" />,
      })
    })
  }

  handleError = err => {
    console.error(err);
  };

  handleScan = data => {
    if (data) {
      const address = data.split(":")[1].split("?")[0];
      const amount = data.split("=")[1];
      this.setState(() => ({
        address,
        amount
      }));
      this.openScan();
    }
  };

  addressIsCorrect() {
    const { address } = this.state

    return typeforce.isCoinAddress.BTC(address)
  }

  render() {
    const {
      address,
      amount,
      code,
      balance,
      isShipped,
      minus,
      ethBalance,
      exCurrencyRate,
      currentDecimals,
      error,
      mnemonic,
      openScanCam,
      step,
      ownTx,
      sendSmsTimeout,
      sendSmsStatus,
    } = this.state

    const {
      name,
      data: {
        currency,
        invoice,
      },
      tokenItems,
      items,
      intl,
    } = this.props

    const linked = Link.all(this, 'address', 'amount', 'code', 'ownTx', 'mnemonic')

    const min = minAmount.btc
    const dataCurrency = currency.toUpperCase()

    const isDisabled =
      !address || !amount || isShipped || ownTx
      || !this.addressIsCorrect()
      || BigNumber(amount).isGreaterThan(balance)
      || BigNumber(amount).dp() > currentDecimals

    const NanReplacement = balance || '...'
    const getUsd = amount * exCurrencyRate

    if (new BigNumber(amount).isGreaterThan(0)) {
      linked.amount.check((value) => new BigNumber(value).isLessThanOrEqualTo(balance), (
        <div style={{ width: '340px', fontSize: '12px' }}>
          <FormattedMessage
            id="Withdrow170"
            defaultMessage="The amount must be no more than your balance"
            values={{
              min,
              currency: `${currency}`,
            }}
          />
        </div>
      ))
    }

    if (this.state.amount < 0) {
      this.setState({
        amount: '',
        minus: true,
      })
    }

    const labels = defineMessages({
      withdrowModal: {
        id: 'withdrowTitle271',
        defaultMessage: `Send`,
      },
      ownTxPlaceholder: {
        id: 'withdrawOwnTxPlaceholder',
        defaultMessage: 'Если оплатили с другого источника'
      },
      smsPlaceholder: {
        id: 'withdrawSMSCodePlaceholder',
        defaultMessage: 'Enter SMS-code',
      },
      mnemonicPlaceholder: {
        id: 'registerSMSMPlaceHolder',
        defaultMessage: `12 слов`,
      },
    })

    return (
      <Modal name={name} title={`${intl.formatMessage(labels.withdrowModal)}${' '}${currency.toUpperCase()}`}>
        {openScanCam && (
          <QrReader openScan={this.openScan} handleError={this.handleError} handleScan={this.handleScan} />
        )}
        {invoice &&
          <InvoiceInfoBlock invoiceData={invoice} />
        }
        {step === 'mnemonicSign' &&
          <Fragment>
            <h1>Mnemonic 12 words confirm tx</h1>
            <div styleName="highLevel">
              <FieldLabel label>
                <FormattedMessage id="registerSMSModalWords" defaultMessage="Секретная фраза (12 слов):" />
              </FieldLabel>
              <Input
                styleName="input"
                valueLink={linked.mnemonic}
                multiline={true}
                placeholder={`${intl.formatMessage(labels.mnemonicPlaceholder)}`}
              />
            </div>
            { error && <div className="rednote">{error}</div> }
            <Button styleName="buttonFull" big blue fullWidth disabled={isShipped} onClick={this.handleMnemonicSign}>
              {isShipped
                ? <FormattedMessage id="WithdrawModal11212" defaultMessage="Processing ..." />
                : <FormattedMessage id="btcSMSProtectedSignByMnemonic" defaultMessage="Использовать секретную фразу" />
              }
            </Button>
          </Fragment>
        }
        {step === 'fillform' &&
          <Fragment>
            <p styleName="notice">
              <FormattedMessage
                id="Withdrow213"
                defaultMessage="Please note: Fee is {minAmount} {data}.{br}Your balance must exceed this sum to perform transaction"
                values={{ minAmount: `${min}`, br: <br />, data: `${dataCurrency}` }} />
            </p>
            <div styleName="highLevel" style={{ marginBottom: "20px" }}>
              <FieldLabel inRow>
                <span style={{ fontSize: '16px' }}>
                  <FormattedMessage id="Withdrow1194" defaultMessage="Address " />
                </span>
                {' '}
                <Tooltip id="WtH203" >
                  <div style={{ textAlign: 'center' }}>
                    <FormattedMessage
                      id="WTH275"
                      defaultMessage="Make sure the wallet you{br}are sending the funds to supports {currency}"
                      values={{ br: <br />, currency: `${currency.toUpperCase()}` }}
                    />
                  </div>
                </Tooltip>
              </FieldLabel>
              <Input
                valueLink={linked.address}
                focusOnInit
                pattern="0-9a-zA-Z:"
                placeholder={`Enter ${currency.toUpperCase()} address to transfer`}
                qr
                withMargin
                openScan={this.openScan}
              />
              {address && !this.addressIsCorrect() && (
                <div styleName="rednote">
                  <FormattedMessage
                    id="WithdrawIncorectAddress"
                    defaultMessage="Your address not correct" />
                </div>
              )}
            </div>
            <div styleName="lowLevel" style={{ marginBottom: "50px" }}>
              <p styleName="balance">
                {balance} {currency.toUpperCase()}
              </p>
              <FieldLabel>
                <FormattedMessage id="Withdrow118" defaultMessage="Amount " />
              </FieldLabel>

              <div styleName="group">
                <Input
                  styleName="input"
                  valueLink={linked.amount}
                  pattern="0-9\."
                  placeholder="Enter the amount"
                  usd={getUsd.toFixed(2)}
                  onKeyDown={inputReplaceCommaWithDot}
                />
                <div style={{ marginLeft: "15px" }}>
                  <Button blue big onClick={this.sellAllBalance} data-tip data-for="Withdrow134">
                    <FormattedMessage id="Select210" defaultMessage="MAX" />
                  </Button>
                </div>
                {!isMobile && (
                  <ReactTooltip id="Withdrow134" type="light" effect="solid" styleName="r-tooltip">
                    <FormattedMessage
                      id="WithdrawButton32"
                      defaultMessage="when you click this button, in the field, an amount equal to your balance minus the miners commission will appear"
                    />
                  </ReactTooltip>
                )}
                {!linked.amount.error && (
                  <div styleName={minus ? "rednote" : "note"}>
                    <FormattedMessage
                      id="WithdrawModal256"
                      defaultMessage="No less than {minAmount}"
                      values={{ minAmount: `${min}` }}
                    />
                  </div>
                )}
              </div>
            </div>
            <Button styleName="buttonFull" big blue fullWidth disabled={isDisabled} onClick={this.handleSubmit}>
              {isShipped
                ? (
                  <Fragment>
                    <FormattedMessage id="WithdrawModal11212" defaultMessage="Processing ..." />
                  </Fragment>
                )
                : (
                  <Fragment>
                    <FormattedMessage id="WithdrawModal111" defaultMessage="Withdraw" />
                    {' '}
                    {`${currency.toUpperCase()}`}
                  </Fragment>
                )
              }
            </Button>
            {
              error && (
                <div styleName="rednote">
                  <FormattedMessage
                    id="WithdrawModalErrorSend"
                    defaultMessage="{errorName} {currency}:{br}{errorMessage}"
                    values={{
                      errorName: intl.formatMessage(error.name),
                      errorMessage: intl.formatMessage(error.message),
                      br: <br />,
                      currency: `${currency}`,
                    }}
                  />
                </div>
              )
            }
            {invoice && 
              <Fragment>
                <hr />
                <div styleName="lowLevel" style={{ marginBottom: "50px" }}>
                  <div styleName="groupField">
                    <div styleName="downLabel">
                      <FieldLabel inRow>
                        <span styleName="mobileFont">
                          <FormattedMessage id="WithdrowOwnTX" defaultMessage="Или укажите TX" />
                        </span>
                      </FieldLabel>
                    </div>
                  </div>
                  <div styleName="group">
                    <Input
                      styleName="input"
                      valueLink={linked.ownTx}
                      placeholder={`${intl.formatMessage(labels.ownTxPlaceholder)}`}
                    />
                  </div>
                </div>
                <Button styleName="buttonFull" big blue fullWidth disabled={(!(ownTx) || isShipped)} onClick={this.handleSubmit}>
                  {isShipped
                    ? (
                      <Fragment>
                        <FormattedMessage id="WithdrawModal11212" defaultMessage="Processing ..." />
                      </Fragment>
                    )
                    : (
                      <FormattedMessage id="WithdrawModalInvoiceSaveTx" defaultMessage="Отметить как оплаченный" />
                    )
                  }
                </Button>
              </Fragment>
            }
          </Fragment>
        }
        
        {step === 'confirm' &&
          <Fragment>
            <p styleName="notice">
              <FormattedMessage id="Withdrow2222" defaultMessage="Send SMS code" />
            </p>
            <div styleName="lowLevel">
              <div styleName="groupField">
                <div styleName="downLabel">
                  <FieldLabel inRow>
                    <span styleName="mobileFont">
                      <FormattedMessage id="Withdrow2223" defaultMessage="SMS code" />
                    </span>
                  </FieldLabel>
                </div>
              </div>
              <div styleName="group" style={{ marginBottom: "50px" }}>
                <Input
                  styleName="input"
                  valueLink={linked.code}
                  pattern="0-9"
                  placeholder={`${intl.formatMessage(labels.smsPlaceholder)}`}
                />
              </div>
              { sendSmsStatus === 'sending' && (
                <div className="notes">
                  <FormattedMessage id="WithdrawSMS_SmsSending" defaultMessage="Отправка проверочного кода" />
                </div>
              )}
              { sendSmsStatus === 'sended' && (
                <div className="notes">
                  <FormattedMessage
                    id="WithdrawSMS_SmsSended"
                    defaultMessage="Код отправлен. Повторно отправить код можно будет через {sendSmsTimeout}"
                    values={{sendSmsTimeout}}
                  />
                </div>
              )}
              { sendSmsStatus === 'offline' && (
                <div className="rednotes">
                  <FormattedMessage
                    id="WithdrawSMS_ServerOffline"
                    defaultMessage="Сервер авторизации не доступен. Попробуйте позже или используйте секретную фразу"
                  />
                </div>
              )}
              <Button styleName="buttonFull" fullWidth big blue onClick={this.handleConfirmSMS}>
                <FormattedMessage id="Withdrow2224" defaultMessage="Confirm" />
              </Button>
              {
                linked.code.error && (
                  <div styleName="rednote error">
                    <FormattedMessage id="WithdrawModal2225" defaultMessage="Something went wrong, enter your current code please" />
                  </div>
                )
              }

            </div>
          </Fragment>
        }
      </Modal>
    )
  }
}

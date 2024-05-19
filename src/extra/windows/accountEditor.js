import * as ui from '../ui_lib'
import { VoucherType } from '../../system/voucher'
import { EggGachaUiHandlerExport } from '../../ui/egg-gacha-ui-handler.ts'

const window = new ui.OverlayWindow('account editor', false, {})

const VoucherTypes = Object.keys(VoucherType).filter((v) => isNaN(Number(v)))
VoucherTypes.forEach((voucher, id) => {
    const textbox = new ui.TextBox(window, `set "${voucher}"`, (value) => {
        let newValue = value.target.value.replace(/\D/g, '') // remove all non-numbers
        newValue = newValue == '' ? 0 : parseInt(newValue)

        textbox.value = newValue
        if (gameDataExport) {
            gameDataExport.voucherCounts[id] = newValue
            if (EggGachaUiHandlerExport) {
                EggGachaUiHandlerExport.updateVoucherCounts()
            }
        }
    }, true)
})

export default window
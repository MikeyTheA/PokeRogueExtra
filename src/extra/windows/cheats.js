import * as ui from '../ui_lib'
import * as data from '../configuration'
import { starterSelectUiHandlerExport } from '#app/ui/starter-select-ui-handler'
import { battleSceneExport } from '#app/battle-scene'

const window = new ui.OverlayWindow("cheats", false, {})

const godmode = new ui.Checkbox(window, "god mode", (val) => { data.set("configs/godmode", val) })
godmode.element.checked = data.get("configs/godmode") || false

const instantkill = new ui.Checkbox(window, "instant kill", (val) => { data.set("configs/onehit", val) })
instantkill.element.checked = data.get("configs/onehit") || false

const alwayscatch = new ui.Checkbox(window, "always catch", (val) => { data.set("configs/alwayscatch", val) })
alwayscatch.element.checked = data.get("configs/alwayscatch") || false

const infselectionpoints = new ui.Checkbox(window, "inf pokemon selection points", (val) => { 
    data.set("configs/infselectionpoints", val)
    starterSelectUiHandlerExport.tryUpdateValue()
})
infselectionpoints.element.checked = data.get("configs/infselectionpoints") || false

export const moneyEditor = new ui.TextBox(window, "money editor", (value) => {
    let newValue = value.target.value.replace(/\D/g, '') // remove all non-numbers
    newValue = newValue == '' ? 0 : parseInt(newValue)
    moneyEditor.value = newValue

    if(battleSceneExport){
        battleSceneExport.money = newValue
        battleSceneExport.updateMoneyText()
    }
})

export default window
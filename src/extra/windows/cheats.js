import * as ui from '../ui_lib'
import * as data from '../configuration'

const window = new ui.OverlayWindow("cheats", false, {})
const godmode = new ui.Checkbox(window, "god mode", (val) => { data.set("configs/godmode", val) })
godmode.element.checked = data.get("configs/godmode") || false
const instantkill = new ui.Checkbox(window, "instant kill", (val) => { data.set("configs/onehit", val) })
instantkill.element.checked = data.get("configs/onehit") || false
const alwayscatch = new ui.Checkbox(window, "always catch", (val) => { data.set("configs/alwayscatch", val) })
alwayscatch.element.checked = data.get("configs/alwayscatch") || false

export default window
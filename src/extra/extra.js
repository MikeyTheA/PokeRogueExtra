import * as ui from './ui_lib'
import * as data from './configuration'

const extra = async () => {
    const SETTINGS = new ui.OverlayWindow("settings", true, {})

    const windows = {}
    const windowModules = Object.entries(import.meta.glob('./windows/*.js'))
    await Promise.all(windowModules.map(async ([path, module]) => {
        windows[path] = (await module()).default
    }))

    // settings
    Object.keys(windows).forEach(element => {
        element = windows[element]
        console.log(element)
        const container = new ui.Container(SETTINGS, element.name)
        const visible = new ui.Checkbox(container, "Visible", (val) => { element.visible = val; data.set(`windows/${element.name}/visible`, val) })
        visible.element.checked = data.get(`windows/${element.name}/visible`) || false
        element.visible = data.get(`windows/${element.name}/visible`) || false
        const opacity = new ui.Slider(container, "Opacity", (val) => { element.element.style.opacity = val + '%'; data.set(`windows/${element.name}/opacity`, val) })
        element.element.style.opacity = data.get(`windows/${element.name}/opacity`) + "%" || '100%'
        opacity.element.value = data.get(`windows/${element.name}/opacity`) || 100
    });
}

export default extra
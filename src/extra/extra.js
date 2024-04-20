import * as ui from './ui_lib'
import {battleScene} from '../battle-scene'
import * as data from './configuration'
import { getNatureName } from '../data/nature'
const extra = async () => {
    const SETTINGS = new ui.OverlayWindow("settings", true, {})

    const windows = {}
    
    // cheats
    windows['cheats'] = new ui.OverlayWindow("cheats", false, {})
    const godmode = new ui.Checkbox(windows['cheats'], "god mode", (val) => {data.set("configs/godmode", val)})
    godmode.element.checked = data.get("configs/godmode") || false
    const instantkill = new ui.Checkbox(windows['cheats'], "instant kill", (val) => {data.set("configs/onehit", val)})
    instantkill.element.checked = data.get("configs/onehit") || false
    const alwayscatch = new ui.Checkbox(windows['cheats'], "always catch", (val) => {data.set("configs/alwayscatch", val)})
    alwayscatch.element.checked = data.get("configs/alwayscatch") || false

    // enemy party
    const enemyParty = {}
    const refreshEnemyParty = () => {
        if(battleScene){
            window.battleScene = battleScene
            const party = battleScene.getEnemyParty()
            party.forEach(enemy => {
                if (enemy.id in enemyParty){
                    enemyParty[enemy.id]['hp'].element.textContent = `hp: ${enemy.hp}`
                    enemyParty[enemy.id]['level'].element.textContent = `level: ${enemy.level}`
                }else{
                    enemyParty[enemy.id] = {
                        container: new ui.Container(windows['enemy party'], enemy.name, false)
                    }
    
                    enemyParty[enemy.id]['hp'] = new ui.Label(enemyParty[enemy.id].container, `hp: ${enemy.hp}`)
                    enemyParty[enemy.id]['ivs'] = new ui.Label(enemyParty[enemy.id].container, `ivs: ${enemy.ivs}`)

                    enemyParty[enemy.id]['moveset'] = new ui.Container(enemyParty[enemy.id].container, `moveset`)
                    enemy.getMoveset().forEach(move => {
                        new ui.Label(enemyParty[enemy.id]['moveset'], move.getName())
                    })

                    enemyParty[enemy.id]['level'] = new ui.Label(enemyParty[enemy.id].container, `level: ${enemy.level}`)
                    enemyParty[enemy.id]['nature'] = new ui.Label(enemyParty[enemy.id].container, `nature: ${getNatureName(enemy.nature)}`)
                    enemyParty[enemy.id]['shiny'] = new ui.Label(enemyParty[enemy.id].container, `shiny: ${enemy.shiny}`)
                }
            })
    
            Object.keys(enemyParty).forEach(enemy => {
                let found = false
                party.forEach(enemyReal => {
                    if (enemy == enemyReal.id){
                        found = true
                    }
                })
                if(!found){
                    enemyParty[enemy].container.delete()
                    delete enemyParty[enemy]
                }
            })
        }
        
        
        setTimeout(refreshEnemyParty, 500)
    }
    refreshEnemyParty()

    windows['enemy party'] = new ui.OverlayWindow('enemy party', false, {})

    

    
    // settings
    Object.keys(windows).forEach(element => {
        element = windows[element]
        const container = new ui.Container(SETTINGS, element.name)
        const visible = new ui.Checkbox(container, "Visible", (val) => {element.visible = val; data.set(`windows/${element.name}/visible`, val)})
        visible.element.checked = data.get(`windows/${element.name}/visible`) || false
        element.visible = data.get(`windows/${element.name}/visible`) || false
        const opacity = new ui.Slider(container, "Opacity", (val) => {element.element.style.opacity = val + '%'; data.set(`windows/${element.name}/opacity`, val)})
        element.element.style.opacity = data.get(`windows/${element.name}/opacity`) + "%" || '100%'
        opacity.element.value = data.get(`windows/${element.name}/opacity`) || 100
    });
}

export default extra
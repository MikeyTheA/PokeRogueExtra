import * as ui from '../ui_lib'
import { battleSceneExport } from '../../battle-scene'
import { getNatureName } from '../../data/nature'

const enemyPartyWindow = new ui.OverlayWindow('enemy party', false, {})

const enemyParty = {}
const refreshEnemyParty = () => {
    if (battleSceneExport && enemyPartyWindow) {
        window.battleSceneExport = battleSceneExport
        const party = battleSceneExport.getEnemyParty()
        party.forEach(enemy => {
            if (enemy.id in enemyParty) {
                enemyParty[enemy.id]['hp'].element.textContent = `hp: ${enemy.hp}`
                enemyParty[enemy.id]['level'].element.textContent = `level: ${enemy.level}`
            } else {
                enemyParty[enemy.id] = {
                    container: new ui.Container(enemyPartyWindow, enemy.name, false)
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
                if (enemy == enemyReal.id) {
                    found = true
                }
            })
            if (!found) {
                enemyParty[enemy].container.delete()
                delete enemyParty[enemy]
            }
        })
    }


    setTimeout(refreshEnemyParty, 500)
}
refreshEnemyParty()

export default enemyPartyWindow
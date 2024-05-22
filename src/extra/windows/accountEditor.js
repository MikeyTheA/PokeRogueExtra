import * as ui from '../ui_lib'
import { gameDataExport, battleSceneExport } from '../../battle-scene'
import { EggLapsePhase } from '../../phases'

const window = new ui.OverlayWindow('account editor', false, {})

new ui.Button(window, 'Manual Save', () => {
    if(gameDataExport){
        gameDataExport.saveSystem()
    }
})

export const voucherContainer = new ui.Container(window, 'Vouchers')
export const statsContainer = new ui.Container(window, 'Stats')
export const eggsContainer = new ui.Container(window, 'Eggs')

new ui.Button(eggsContainer, 'force hatch all now', () => {
    if(battleSceneExport){
        new EggLapsePhase(battleSceneExport).startForce()
    }
})



export default window
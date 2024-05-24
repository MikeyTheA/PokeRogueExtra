import * as ui from '../ui_lib'
import { gameDataExport, battleSceneExport } from '../../battle-scene'
import { EggLapsePhase } from '../../phases'
import { GachaType } from '../../data/egg'
import { EggTier } from '../../data/enums/egg-type'
import { eggListUiHandlerExport } from '../../ui/egg-list-ui-handler'

const window = new ui.OverlayWindow('account editor', false, {})

new ui.Button(window, 'Manual Save', () => {
    if(gameDataExport){
        gameDataExport.saveSystem()
    }
})

export const voucherContainer = new ui.Container(window, 'Vouchers')
export const statsContainer = new ui.Container(window, 'Stats')
export const eggsContainer = new ui.Container(window, 'Eggs')

export const tierContainer = new ui.Container(eggsContainer, 'set all eggs to TIER')
export const gachaTypeContainer = new ui.Container(eggsContainer, 'set all eggs to GACHA TYPE')

new ui.Button(eggsContainer, 'force hatch all now', () => {
    if(battleSceneExport){
        new EggLapsePhase(battleSceneExport).start(true)
    }
})

const gatchaTypes = Object.keys(GachaType).filter((v) => isNaN(Number(v)))

const updateEggList = () => {
    gameDataExport.eggs.forEach((egg) => {
        eggListUiHandlerExport.setEggDetails(egg)
    })
}

gatchaTypes.forEach((gachaType, index) => {
    new ui.Button(gachaTypeContainer, gachaType, () => {
        gameDataExport.eggs.forEach((egg) => {
            egg.gachaType = index
        })
        updateEggList()
        const cursor = eggListUiHandlerExport.getCursor()
        eggListUiHandlerExport.eggListIconContainer.removeAll(true);
        eggListUiHandlerExport.show()
        eggListUiHandlerExport.setCursor(cursor)
    })
})

const eggTiers = Object.keys(EggTier).filter((v) => isNaN(Number(v)))

eggTiers.forEach((eggTier, index) => {
    new ui.Button(tierContainer, eggTier, () => {
        gameDataExport.eggs.forEach((egg) => {
            egg.tier = index
        })
        updateEggList()
        const cursor = eggListUiHandlerExport.getCursor()
        eggListUiHandlerExport.eggListIconContainer.removeAll(true);
        eggListUiHandlerExport.show()
        eggListUiHandlerExport.setCursor(cursor)
    })
})

export default window
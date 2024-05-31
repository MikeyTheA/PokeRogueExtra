import * as ui from "../ui_lib";
import { gameDataExport } from "../../battle-scene";
import { GachaType } from "../../data/egg";
import { EggTier } from "../../data/enums/egg-type";
import { eggListUiHandlerExport } from "../../ui/egg-list-ui-handler";
import * as data from "../configuration";

const window = new ui.OverlayWindow("account editor", false, {});

new ui.Button(window, "Manual Save", () => {
  if (gameDataExport) {
    gameDataExport.saveSystem();
  }
});

export const voucherContainer = new ui.Container(window, "Vouchers");
export const statsContainer = new ui.Container(window, "Stats");
export const eggsContainer = new ui.Container(window, "Eggs");

const alwaysshiny = new ui.Checkbox(window, "always shiny", (val) => {
  data.set("configs/alwaysshiny", val);
});
alwaysshiny.element.checked = data.get("configs/alwaysshiny") || false;

const noeggwaves = new ui.Checkbox(eggsContainer, "no egg wave requirement", (val) => {
  data.set("configs/noeggwaverequirement", val);
});
noeggwaves.element.checked = data.get("configs/noeggwaverequirement") || false;

export const tierContainer = new ui.Container(eggsContainer, "set all eggs to TIER");
export const gachaTypeContainer = new ui.Container(eggsContainer, "set all eggs to GACHA TYPE");

const gatchaTypes = Object.keys(GachaType).filter((v) => isNaN(Number(v)));

const updateEggList = () => {
  gameDataExport.eggs.forEach((egg) => {
    eggListUiHandlerExport.setEggDetails(egg);
  });
};

gatchaTypes.forEach((gachaType, index) => {
  new ui.Button(gachaTypeContainer, gachaType, () => {
    gameDataExport.eggs.forEach((egg) => {
      egg.gachaType = index;
    });
    if (eggListUiHandlerExport.active) {
      updateEggList();
      const cursor = eggListUiHandlerExport.getCursor();
      eggListUiHandlerExport.eggListIconContainer.removeAll(true);
      eggListUiHandlerExport.show();
      eggListUiHandlerExport.setCursor(cursor);
    }
  });
});

const eggTiers = Object.keys(EggTier).filter((v) => isNaN(Number(v)));

eggTiers.forEach((eggTier, index) => {
  new ui.Button(tierContainer, eggTier, () => {
    gameDataExport.eggs.forEach((egg) => {
      egg.tier = index;
    });
    if (eggListUiHandlerExport.active) {
      updateEggList();
      const cursor = eggListUiHandlerExport.getCursor();
      eggListUiHandlerExport.eggListIconContainer.removeAll(true);
      eggListUiHandlerExport.show();
      eggListUiHandlerExport.setCursor(cursor);
    }
  });
});

export default window;

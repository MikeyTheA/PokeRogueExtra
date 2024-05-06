import BattleScene from "../battle-scene";
import { Setting, reloadSettings, settingDefaults, settingOptions } from "../system/settings";
import { hasTouchscreen, isMobile } from "../touch-controls";
import { TextStyle, addTextObject } from "./text";
import { Mode } from "./ui";
import UiHandler from "./ui-handler";
import { addWindow } from "./ui-theme";
import {Button} from "../enums/buttons";

export default class SettingsUiHandler extends UiHandler {
  private settingsContainer: Phaser.GameObjects.Container;
  private optionsContainer: Phaser.GameObjects.Container;

  private scrollCursor: integer;

  private optionsBg: Phaser.GameObjects.NineSlice;

  private optionCursors: integer[];

  private settingLabels: Phaser.GameObjects.Text[];
  private optionValueLabels: Phaser.GameObjects.Text[][];

  private cursorObj: Phaser.GameObjects.NineSlice;

  private reloadRequired: boolean;
  private reloadI18n: boolean;

  constructor(scene: BattleScene, mode?: Mode) {
    super(scene, mode);

    this.reloadRequired = false;
    this.reloadI18n = false;
  }

  setup() {
    const ui = this.getUi();
    
    this.settingsContainer = this.scene.add.container(1, -(this.scene.game.canvas.height / 6) + 1);

    this.settingsContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, this.scene.game.canvas.width / 6, this.scene.game.canvas.height / 6), Phaser.Geom.Rectangle.Contains);

    const headerBg = addWindow(this.scene, 0, 0, (this.scene.game.canvas.width / 6) - 2, 24);
    headerBg.setOrigin(0, 0);

    const headerText = addTextObject(this.scene, 0, 0, 'Options', TextStyle.SETTINGS_LABEL);
    headerText.setOrigin(0, 0);
    headerText.setPositionRelative(headerBg, 8, 4);

    this.optionsBg = addWindow(this.scene, 0, headerBg.height, (this.scene.game.canvas.width / 6) - 2, (this.scene.game.canvas.height / 6) - headerBg.height - 2);
    this.optionsBg.setOrigin(0, 0);

    this.optionsContainer = this.scene.add.container(0, 0);

    this.settingLabels = [];
    this.optionValueLabels = [];

    Object.keys(Setting).forEach((setting, s) => {
      let settingName = setting.replace(/\_/g, ' ');
      if (reloadSettings.includes(Setting[setting]))
        settingName += ' (Requires Reload)';

      this.settingLabels[s] = addTextObject(this.scene, 8, 28 + s * 16, settingName, TextStyle.SETTINGS_LABEL);
      this.settingLabels[s].setOrigin(0, 0);

      this.optionsContainer.add(this.settingLabels[s]);

      this.optionValueLabels.push(settingOptions[Setting[setting]].map((option, o) => {
        const valueLabel = addTextObject(this.scene, 0, 0, option, settingDefaults[Setting[setting]] === o ? TextStyle.SETTINGS_SELECTED : TextStyle.WINDOW);
        valueLabel.setOrigin(0, 0);

        this.optionsContainer.add(valueLabel);

        return valueLabel;
      }));

      const totalWidth = this.optionValueLabels[s].map(o => o.width).reduce((total, width) => total += width, 0);

      const labelWidth =  Math.max(78, this.settingLabels[s].displayWidth + 8);

      const totalSpace = (300 - labelWidth) - totalWidth / 6;
      const optionSpacing = Math.floor(totalSpace / (this.optionValueLabels[s].length - 1));

      let xOffset = 0;

      for (let value of this.optionValueLabels[s]) {
        value.setPositionRelative(this.settingLabels[s], labelWidth + xOffset, 0);
        xOffset += value.width / 6 + optionSpacing;
      }
    });

    this.optionCursors = Object.values(settingDefaults);

    this.settingsContainer.add(headerBg);
    this.settingsContainer.add(headerText);
    this.settingsContainer.add(this.optionsBg);
    this.settingsContainer.add(this.optionsContainer);

    ui.add(this.settingsContainer);

    this.setCursor(0);
    this.setScrollCursor(0);

    this.settingsContainer.setVisible(false);
  }

  show(args: any[]): boolean {
    super.show(args);
    
    const settings: object = localStorage.hasOwnProperty('settings') ? JSON.parse(localStorage.getItem('settings')) : {};

    Object.keys(settingDefaults).forEach((setting, s) => this.setOptionCursor(s, settings.hasOwnProperty(setting) ? settings[setting] : settingDefaults[setting]));

    this.settingsContainer.setVisible(true);
    this.setCursor(0);

    this.getUi().moveTo(this.settingsContainer, this.getUi().length - 1);

    this.getUi().hideTooltip();

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    if (button === Button.CANCEL) {
      success = true;
      this.scene.ui.revertMode();
    } else {
      const cursor = this.cursor + this.scrollCursor;
      switch (button) {
        case Button.UP:
          if (cursor) {
            if (this.cursor)
              success = this.setCursor(this.cursor - 1);
            else
              success = this.setScrollCursor(this.scrollCursor - 1);
          }
          break;
        case Button.DOWN:
          if (cursor < this.optionValueLabels.length) {
            if (this.cursor < 8)
              success = this.setCursor(this.cursor + 1);
            else if (this.scrollCursor < this.optionValueLabels.length - 9)
              success = this.setScrollCursor(this.scrollCursor + 1);
          }
          break;
        case Button.LEFT:
          if (this.optionCursors[cursor])
            success = this.setOptionCursor(cursor, this.optionCursors[cursor] - 1, true);
          break;
        case Button.RIGHT:
          if (this.optionCursors[cursor] < this.optionValueLabels[cursor].length - 1)
            success = this.setOptionCursor(cursor, this.optionCursors[cursor] + 1, true);
          break;
      }
    }

    if (success)
      ui.playSelect();

    return success;
  }

  setCursor(cursor: integer): boolean {
    const ret = super.setCursor(cursor);

    if (!this.cursorObj) {
      this.cursorObj = this.scene.add.nineslice(0, 0, 'summary_moves_cursor', null, (this.scene.game.canvas.width / 6) - 10, 16, 1, 1, 1, 1);
      this.cursorObj.setOrigin(0, 0);
      this.optionsContainer.add(this.cursorObj);
    }

    this.cursorObj.setPositionRelative(this.optionsBg, 4, 4 + (this.cursor + this.scrollCursor) * 16);

    return ret;
  }

  setOptionCursor(settingIndex: integer, cursor: integer, save?: boolean): boolean {
    const setting = Setting[Object.keys(Setting)[settingIndex]];

    if (setting === Setting.Touch_Controls && cursor && hasTouchscreen() && isMobile()) {
      this.getUi().playError();
      return false;
    }

    const lastCursor = this.optionCursors[settingIndex];

    const lastValueLabel = this.optionValueLabels[settingIndex][lastCursor];
    lastValueLabel.setColor(this.getTextColor(TextStyle.WINDOW));
    lastValueLabel.setShadowColor(this.getTextColor(TextStyle.WINDOW, true));

    this.optionCursors[settingIndex] = cursor;

    const newValueLabel = this.optionValueLabels[settingIndex][cursor];
    newValueLabel.setColor(this.getTextColor(TextStyle.SETTINGS_SELECTED));
    newValueLabel.setShadowColor(this.getTextColor(TextStyle.SETTINGS_SELECTED, true));

    if (save) {
      this.scene.gameData.saveSetting(setting, cursor)
      if (reloadSettings.includes(setting)) {
        this.reloadRequired = true;
        if (setting === Setting.Language)
          this.reloadI18n = true;
      }
    }

    return true;
  }

  setScrollCursor(scrollCursor: integer): boolean {
    if (scrollCursor === this.scrollCursor)
      return false;

    this.scrollCursor = scrollCursor;

    this.updateSettingsScroll();

    this.setCursor(this.cursor);

    return true;
  }

  updateSettingsScroll(): void {
    this.optionsContainer.setY(-16 * this.scrollCursor);

    for (let s = 0; s < this.settingLabels.length; s++) {
      const visible = s >= this.scrollCursor && s < this.scrollCursor + 9;
      this.settingLabels[s].setVisible(visible);
      for (let option of this.optionValueLabels[s])
        option.setVisible(visible);
    }
  }

  clear() {
    super.clear();
    this.settingsContainer.setVisible(false);
    this.eraseCursor();
    if (this.reloadRequired) {
      this.reloadRequired = false;
      this.scene.reset(true, false, true);
    } 
  }

  eraseCursor() {
    if (this.cursorObj)
      this.cursorObj.destroy();
    this.cursorObj = null;
  }
}
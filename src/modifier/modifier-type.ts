import * as Modifiers from './modifier';
import { AttackMove, allMoves } from '../data/move';
import { Moves } from "../data/enums/moves";
import { PokeballType, getPokeballCatchMultiplier, getPokeballName } from '../data/pokeball';
import Pokemon, { EnemyPokemon, PlayerPokemon, PokemonMove } from '../field/pokemon';
import { EvolutionItem, SpeciesFriendshipEvolutionCondition, pokemonEvolutions } from '../data/pokemon-evolutions';
import { Stat, getStatName } from '../data/pokemon-stat';
import { tmPoolTiers, tmSpecies } from '../data/tms';
import { Type } from '../data/type';
import PartyUiHandler, { PokemonMoveSelectFilter, PokemonSelectFilter } from '../ui/party-ui-handler';
import * as Utils from '../utils';
import { TempBattleStat, getTempBattleStatBoosterItemName, getTempBattleStatName } from '../data/temp-battle-stat';
import { BerryType, getBerryEffectDescription, getBerryName } from '../data/berry';
import { Unlockables } from '../system/unlockables';
import { StatusEffect, getStatusEffectDescriptor } from '../data/status-effect';
import { SpeciesFormKey } from '../data/pokemon-species';
import BattleScene from '../battle-scene';
import { VoucherType, getVoucherTypeIcon, getVoucherTypeName } from '../system/voucher';
import { FormChangeItem, SpeciesFormChangeItemTrigger, pokemonFormChanges } from '../data/pokemon-forms';
import { ModifierTier } from './modifier-tier';
import { Nature, getNatureName, getNatureStatMultiplier } from '#app/data/nature';
import { Localizable } from '#app/plugins/i18n';
import { getModifierTierTextTint } from '#app/ui/text';

const outputModifierData = false;
const useMaxWeightForOutput = false;

type Modifier = Modifiers.Modifier;

export enum ModifierPoolType {
  PLAYER,
  WILD,
  TRAINER,
  ENEMY_BUFF,
  DAILY_STARTER
}

type NewModifierFunc = (type: ModifierType, args: any[]) => Modifier;

export class ModifierType {
  public id: string;
  public generatorId: string;
  public name: string;
  protected description: string;
  public iconImage: string;
  public group: string;
  public soundName: string;
  public tier: ModifierTier;
  protected newModifierFunc: NewModifierFunc;

  constructor(name: string, description: string, newModifierFunc: NewModifierFunc, iconImage?: string, group?: string, soundName?: string) {
    this.name = name;
    this.description = description;
    this.iconImage = iconImage || name?.replace(/[ \-]/g, '_')?.replace(/['\.]/g, '')?.toLowerCase();
    this.group = group || '';
    this.soundName = soundName || 'restore';
    this.newModifierFunc = newModifierFunc;
  }

  getDescription(scene: BattleScene): string {
    return this.description;
  }

  setTier(tier: ModifierTier): void {
    this.tier = tier;
  }

  getOrInferTier(poolType: ModifierPoolType = ModifierPoolType.PLAYER): ModifierTier {
    if (this.tier)
      return this.tier;
    if (!this.id)
      return null;
    let poolTypes: ModifierPoolType[];
    switch (poolType) {
      case ModifierPoolType.PLAYER:
        poolTypes = [ poolType, ModifierPoolType.TRAINER, ModifierPoolType.WILD ];
        break;
      case ModifierPoolType.WILD:
        poolTypes = [ poolType, ModifierPoolType.PLAYER, ModifierPoolType.TRAINER ];
        break;
      case ModifierPoolType.TRAINER:
        poolTypes = [ poolType, ModifierPoolType.PLAYER, ModifierPoolType.WILD ];
        break;
      default:
        poolTypes = [ poolType ];
        break;
    }
    // Try multiple pool types in case of stolen items
    for (let type of poolTypes) {
      const pool = getModifierPoolForType(type);
      for (let tier of Utils.getEnumValues(ModifierTier)) {
        if (!pool.hasOwnProperty(tier))
          continue;
        if (pool[tier].find(m => (m as WeightedModifierType).modifierType.id === (this.generatorId || this.id)))
          return (this.tier = tier);
      }
    }
    return null;
  }

  withIdFromFunc(func: ModifierTypeFunc): ModifierType {
    this.id = Object.keys(modifierTypes).find(k => modifierTypes[k] === func);
    return this;
  }

  newModifier(...args: any[]): Modifier {
    return this.newModifierFunc(this, args);
  }
}

type ModifierTypeGeneratorFunc = (party: Pokemon[], pregenArgs?: any[]) => ModifierType;

export class ModifierTypeGenerator extends ModifierType {
  private genTypeFunc:  ModifierTypeGeneratorFunc;

  constructor(genTypeFunc: ModifierTypeGeneratorFunc) {
    super(null, null, null, null);
    this.genTypeFunc = genTypeFunc;
  }

  generateType(party: Pokemon[], pregenArgs?: any[]) {
    const ret = this.genTypeFunc(party, pregenArgs);
    if (ret) {
      ret.generatorId = ret.id;
      ret.id = this.id;
      ret.setTier(this.tier);
    }
    return ret;
  }
}

export interface GeneratedPersistentModifierType {
  getPregenArgs(): any[];
}

class AddPokeballModifierType extends ModifierType implements Localizable {
  private pokeballType: PokeballType;
  private count: integer;

  constructor(pokeballType: PokeballType, count: integer, iconImage?: string) {
    super('', '', (_type, _args) => new Modifiers.AddPokeballModifier(this, pokeballType, count), iconImage, 'pb', 'pb_bounce_1');
    this.pokeballType = pokeballType;
    this.count = count;
  }

  localize(): void {
    // TODO: Actually use i18n to localize this description.
    this.name = `${this.count}x ${getPokeballName(this.pokeballType)}`;
    this.description = `Receive ${getPokeballName(this.pokeballType)} x${this.count} (Inventory: {AMOUNT}) \nCatch Rate: ${getPokeballCatchMultiplier(this.pokeballType) > -1 ? `${getPokeballCatchMultiplier(this.pokeballType)}x` : 'Certain'}`;
  }
  
  getDescription(scene: BattleScene): string {
    this.localize();
    return this.description.replace('{AMOUNT}', scene.pokeballCounts[this.pokeballType].toString());
  }

}

class AddVoucherModifierType extends ModifierType {
  constructor(voucherType: VoucherType, count: integer) {
    super(`${count}x ${getVoucherTypeName(voucherType)}`, `Receive ${getVoucherTypeName(voucherType)} x${count}`,
      (_type, _args) => new Modifiers.AddVoucherModifier(this, voucherType, count), getVoucherTypeIcon(voucherType), 'voucher');
  }
}

export class PokemonModifierType extends ModifierType {
  public selectFilter: PokemonSelectFilter;

  constructor(name: string, description: string, newModifierFunc: NewModifierFunc, selectFilter?: PokemonSelectFilter, iconImage?: string, group?: string, soundName?: string) {
    super(name, description, newModifierFunc, iconImage, group, soundName);

    this.selectFilter = selectFilter;
  }
}

export class PokemonHeldItemModifierType extends PokemonModifierType {
  constructor(name: string, description: string, newModifierFunc: NewModifierFunc, iconImage?: string, group?: string, soundName?: string) {
    super(name, description, newModifierFunc, (pokemon: PlayerPokemon) => {
      const dummyModifier = this.newModifier(pokemon);
      const matchingModifier = pokemon.scene.findModifier(m => m instanceof Modifiers.PokemonHeldItemModifier && m.pokemonId === pokemon.id && m.matchType(dummyModifier)) as Modifiers.PokemonHeldItemModifier;
      const maxStackCount = dummyModifier.getMaxStackCount(pokemon.scene);
      if (!maxStackCount)
        return `${pokemon.name} can\'t take\nthis item!`;
      if (matchingModifier && matchingModifier.stackCount === maxStackCount)
        return `${pokemon.name} has too many\nof this item!`;
      return null;
    }, iconImage, group, soundName);
  }

  newModifier(...args: any[]): Modifiers.PokemonHeldItemModifier {
    return super.newModifier(...args) as Modifiers.PokemonHeldItemModifier;
  }
}

export class PokemonHpRestoreModifierType extends PokemonModifierType {
  protected restorePoints: integer;
  protected restorePercent: integer;
  protected healStatus: boolean;

  constructor(name: string, restorePoints: integer, restorePercent: integer, healStatus: boolean = false, newModifierFunc?: NewModifierFunc, selectFilter?: PokemonSelectFilter, iconImage?: string, group?: string) {
    super(name, restorePoints ? `Restores ${restorePoints} HP or ${restorePercent}% HP for one Pokémon, whichever is higher` : `Fully restores HP for one Pokémon${healStatus ? ' and heals any status ailment' : ''}`,
      newModifierFunc || ((_type, args) => new Modifiers.PokemonHpRestoreModifier(this, (args[0] as PlayerPokemon).id, this.restorePoints, this.restorePercent, this.healStatus, false)),
    selectFilter || ((pokemon: PlayerPokemon) => {
      if (!pokemon.hp || (pokemon.hp >= pokemon.getMaxHp() && (!this.healStatus || !pokemon.status)))
        return PartyUiHandler.NoEffectMessage;
      return null;
    }), iconImage, group || 'potion');

    this.restorePoints = restorePoints;
    this.restorePercent = restorePercent;
    this.healStatus = healStatus;
  }
}

export class PokemonReviveModifierType extends PokemonHpRestoreModifierType {
  constructor(name: string, restorePercent: integer, iconImage?: string) {
    super(name, 0, restorePercent, false, (_type, args) => new Modifiers.PokemonHpRestoreModifier(this, (args[0] as PlayerPokemon).id, 0, this.restorePercent, false, true),
      ((pokemon: PlayerPokemon) => {
        if (!pokemon.isFainted())
          return PartyUiHandler.NoEffectMessage;
        return null;
      }), iconImage, 'revive');

    this.description = `Revives one Pokémon and restores ${restorePercent}% HP`;
    this.selectFilter = (pokemon: PlayerPokemon) => {
      if (pokemon.hp)
        return PartyUiHandler.NoEffectMessage;
      return null;
    };
  }
}

export class PokemonStatusHealModifierType extends PokemonModifierType {
  constructor(name: string) {
    super(name, `Heals any status ailment for one Pokémon`,
      ((_type, args) => new Modifiers.PokemonStatusHealModifier(this, (args[0] as PlayerPokemon).id)),
      ((pokemon: PlayerPokemon) => {
        if (!pokemon.hp || !pokemon.status)
          return PartyUiHandler.NoEffectMessage;
        return null;
      }));
  }
}

export abstract class PokemonMoveModifierType extends PokemonModifierType {
  public moveSelectFilter: PokemonMoveSelectFilter;

  constructor(name: string, description: string, newModifierFunc: NewModifierFunc, selectFilter?: PokemonSelectFilter, moveSelectFilter?: PokemonMoveSelectFilter,
    iconImage?: string, group?: string) {
    super(name, description, newModifierFunc, selectFilter, iconImage, group);

    this.moveSelectFilter = moveSelectFilter;
  }
}

export class PokemonPpRestoreModifierType extends PokemonMoveModifierType {
  protected restorePoints: integer;

  constructor(name: string, restorePoints: integer, iconImage?: string) {
    super(name, `Restores ${restorePoints > -1 ? restorePoints : 'all'} PP for one Pokémon move`, (_type, args) => new Modifiers.PokemonPpRestoreModifier(this, (args[0] as PlayerPokemon).id, (args[1] as integer), this.restorePoints),
      (_pokemon: PlayerPokemon) => {
      return null;
    }, (pokemonMove: PokemonMove) => {
      if (!pokemonMove.ppUsed)
        return PartyUiHandler.NoEffectMessage;
      return null;
    }, iconImage, 'ether');

    this.restorePoints = restorePoints;
  }
}

export class PokemonAllMovePpRestoreModifierType extends PokemonModifierType {
  protected restorePoints: integer;

  constructor(name: string, restorePoints: integer, iconImage?: string) {
    super(name, `Restores ${restorePoints > -1 ? restorePoints : 'all'} PP for all of one Pokémon's moves`, (_type, args) => new Modifiers.PokemonAllMovePpRestoreModifier(this, (args[0] as PlayerPokemon).id, this.restorePoints),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.getMoveset().filter(m => m.ppUsed).length)
          return PartyUiHandler.NoEffectMessage;
        return null;
      }, iconImage, 'elixir');

    this.restorePoints = restorePoints;
  }
}

export class PokemonPpUpModifierType extends PokemonMoveModifierType {
  protected upPoints: integer;

  constructor(name: string, upPoints: integer, iconImage?: string) {
    super(name, `Permanently increases PP for one Pokémon move by ${upPoints} for every 5 maximum PP (maximum 3)`, (_type, args) => new Modifiers.PokemonPpUpModifier(this, (args[0] as PlayerPokemon).id, (args[1] as integer), this.upPoints),
      (_pokemon: PlayerPokemon) => {
      return null;
    }, (pokemonMove: PokemonMove) => {
      if (pokemonMove.getMove().pp < 5 || pokemonMove.ppUp >= 3)
        return PartyUiHandler.NoEffectMessage;
      return null;
    }, iconImage, 'ppUp');

    this.upPoints = upPoints;
  }
}

export class PokemonNatureChangeModifierType extends PokemonModifierType {
  protected nature: Nature;

  constructor(nature: Nature) {
    super(`${getNatureName(nature)} Mint`, `Changes a Pokémon\'s nature to ${getNatureName(nature, true, true, true)} and permanently unlocks the nature for the starter.`, ((_type, args) => new Modifiers.PokemonNatureChangeModifier(this, (args[0] as PlayerPokemon).id, this.nature)),
      ((pokemon: PlayerPokemon) => {
        if (pokemon.getNature() === this.nature)
          return PartyUiHandler.NoEffectMessage;
        return null;
      }), `mint_${Utils.getEnumKeys(Stat).find(s => getNatureStatMultiplier(nature, Stat[s]) > 1)?.toLowerCase() || 'neutral' }`, 'mint');

    this.nature = nature;
  }
}

export class RememberMoveModifierType extends PokemonModifierType {
  constructor(name: string, description: string, iconImage?: string, group?: string) {
    super(name, description, (type, args) => new Modifiers.RememberMoveModifier(type, (args[0] as PlayerPokemon).id, (args[1] as integer)),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.getLearnableLevelMoves().length)
          return PartyUiHandler.NoEffectMessage;
        return null;
      }, iconImage, group);
  }
}

export class DoubleBattleChanceBoosterModifierType extends ModifierType {
  public battleCount: integer;

  constructor(name: string, battleCount: integer) {
    super(name, `Doubles the chance of an encounter being a double battle for ${battleCount} battles`, (_type, _args) => new Modifiers.DoubleBattleChanceBoosterModifier(this, this.battleCount),
      null, 'lure');

    this.battleCount = battleCount;
  }
}

export class TempBattleStatBoosterModifierType extends ModifierType implements GeneratedPersistentModifierType {
  public tempBattleStat: TempBattleStat;

  constructor(tempBattleStat: TempBattleStat) {
    super(getTempBattleStatBoosterItemName(tempBattleStat),
      `Increases the ${getTempBattleStatName(tempBattleStat)} of all party members by 1 stage for 5 battles`,
      (_type, _args) => new Modifiers.TempBattleStatBoosterModifier(this, this.tempBattleStat),
      getTempBattleStatBoosterItemName(tempBattleStat).replace(/\./g, '').replace(/[ ]/g, '_').toLowerCase());

    this.tempBattleStat = tempBattleStat;
  }

  getPregenArgs(): any[] {
    return [ this.tempBattleStat ];
  }
}

export class BerryModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  private berryType: BerryType;

  constructor(berryType: BerryType) {
    super(getBerryName(berryType), getBerryEffectDescription(berryType),
      (type, args) => new Modifiers.BerryModifier(type, (args[0] as Pokemon).id, berryType),
      null, 'berry');
    
    this.berryType = berryType;
  }

  getPregenArgs(): any[] {
    return [ this.berryType ];
  }
}

function getAttackTypeBoosterItemName(type: Type) {
  switch (type) {
    case Type.NORMAL:
      return 'Silk Scarf';
    case Type.FIGHTING:
      return 'Black Belt';
    case Type.FLYING:
      return 'Sharp Beak';
    case Type.POISON:
      return 'Poison Barb';
    case Type.GROUND:
      return 'Soft Sand';
    case Type.ROCK:
      return 'Hard Stone';
    case Type.BUG:
      return 'Silver Powder';
    case Type.GHOST:
      return 'Spell Tag';
    case Type.STEEL:
      return 'Metal Coat';
    case Type.FIRE:
      return 'Charcoal';
    case Type.WATER:
      return 'Mystic Water';
    case Type.GRASS:
      return 'Miracle Seed';
    case Type.ELECTRIC:
      return 'Magnet';
    case Type.PSYCHIC:
      return 'Twisted Spoon';
    case Type.ICE:
      return 'Never-Melt Ice'
    case Type.DRAGON:
      return 'Dragon Fang';
    case Type.DARK:
      return 'Black Glasses';
    case Type.FAIRY:
      return 'Fairy Feather';
  }
}

export class AttackTypeBoosterModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  public moveType: Type;
  public boostPercent: integer;

  constructor(moveType: Type, boostPercent: integer) {
    super(getAttackTypeBoosterItemName(moveType), `Increases the power of a Pokémon's ${Utils.toReadableString(Type[moveType])}-type moves by 20%`,
      (_type, args) => new Modifiers.AttackTypeBoosterModifier(this, (args[0] as Pokemon).id, moveType, boostPercent),
      `${getAttackTypeBoosterItemName(moveType).replace(/[ \-]/g, '_').toLowerCase()}`);

    this.moveType = moveType;
    this.boostPercent = boostPercent;
  }

  getPregenArgs(): any[] {
    return [ this.moveType ];
  }
}

export class PokemonLevelIncrementModifierType extends PokemonModifierType {
  constructor(name: string, iconImage?: string) {
    super(name, `Increases a Pokémon\'s level by 1`, (_type, args) => new Modifiers.PokemonLevelIncrementModifier(this, (args[0] as PlayerPokemon).id),
      (_pokemon: PlayerPokemon) => null, iconImage);
  }
}

export class AllPokemonLevelIncrementModifierType extends ModifierType {
  constructor(name: string, iconImage?: string) {
    super(name, `Increases all party members' level by 1`, (_type, _args) => new Modifiers.PokemonLevelIncrementModifier(this, -1), iconImage);
  }
}

function getBaseStatBoosterItemName(stat: Stat) {
  switch (stat) {
    case Stat.HP:
      return 'HP Up';
    case Stat.ATK:
      return 'Protein';
    case Stat.DEF:
      return 'Iron';
    case Stat.SPATK:
      return 'Calcium';
    case Stat.SPDEF:
      return 'Zinc';
    case Stat.SPD:
      return 'Carbos';
  }
}

export class PokemonBaseStatBoosterModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  private stat: Stat;

  constructor(name: string, stat: Stat, _iconImage?: string) {
    super(name, `Increases the holder's base ${getStatName(stat)} by 10%. The higher your IVs, the higher the stack limit.`, (_type, args) => new Modifiers.PokemonBaseStatModifier(this, (args[0] as Pokemon).id, this.stat));

    this.stat = stat;
  }

  getPregenArgs(): any[] {
    return [ this.stat ];
  }
}

class AllPokemonFullHpRestoreModifierType extends ModifierType {
  constructor(name: string, description?: string, newModifierFunc?: NewModifierFunc, iconImage?: string) {
    super(name, description || `Restores 100% HP for all Pokémon`, newModifierFunc || ((_type, _args) => new Modifiers.PokemonHpRestoreModifier(this, -1, 0, 100, false)), iconImage);
  }
}

class AllPokemonFullReviveModifierType extends AllPokemonFullHpRestoreModifierType {
  constructor(name: string, iconImage?: string) {
    super(name, `Revives all fainted Pokémon, fully restoring HP`, (_type, _args) => new Modifiers.PokemonHpRestoreModifier(this, -1, 0, 100, false, true), iconImage);
  }
}

export class MoneyRewardModifierType extends ModifierType {
  private moneyMultiplier: number;

  constructor(name: string, moneyMultiplier: number, moneyMultiplierDescriptor: string, iconImage?: string) {
    super(name, `Grants a ${moneyMultiplierDescriptor} amount of money (₽{AMOUNT})`, (_type, _args) => new Modifiers.MoneyRewardModifier(this, moneyMultiplier), iconImage, 'money', 'buy');

    this.moneyMultiplier = moneyMultiplier;
  }

  getDescription(scene: BattleScene): string {
    return this.description.replace('{AMOUNT}', scene.getWaveMoneyAmount(this.moneyMultiplier).toLocaleString('en-US'));
  }
}

export class ExpBoosterModifierType extends ModifierType {
  constructor(name: string, boostPercent: integer, iconImage?: string) {
    super(name, `Increases gain of EXP. Points by ${boostPercent}%`, () => new Modifiers.ExpBoosterModifier(this, boostPercent), iconImage);
  }
}

export class PokemonExpBoosterModifierType extends PokemonHeldItemModifierType {
  constructor(name: string, boostPercent: integer, iconImage?: string) {
    super(name, `Increases the holder's gain of EXP. Points by ${boostPercent}%`, (_type, args) => new Modifiers.PokemonExpBoosterModifier(this, (args[0] as Pokemon).id, boostPercent),
      iconImage);
  }
}

export class PokemonFriendshipBoosterModifierType extends PokemonHeldItemModifierType {
  constructor(name: string, iconImage?: string) {
    super(name,'Increases friendship gain per victory by 50%', (_type, args) => new Modifiers.PokemonFriendshipBoosterModifier(this, (args[0] as Pokemon).id), iconImage);
  }
}

export class PokemonMoveAccuracyBoosterModifierType extends PokemonHeldItemModifierType {
  constructor(name: string, amount: integer, iconImage?: string, group?: string, soundName?: string) {
    super(name, `Increases move accuracy by ${amount} (maximum 100)`, (_type, args) => new Modifiers.PokemonMoveAccuracyBoosterModifier(this, (args[0] as Pokemon).id, amount), iconImage, group, soundName);
  }
}

export class PokemonMultiHitModifierType extends PokemonHeldItemModifierType {
  constructor(name: string, iconImage?: string) {
    super(name, `Attacks hit one additional time at the cost of a 60/75/82.5% power reduction per stack respectively.`, (type, args) => new Modifiers.PokemonMultiHitModifier(type as PokemonMultiHitModifierType, (args[0] as Pokemon).id), iconImage);
  }
}

export class TmModifierType extends PokemonModifierType {
  public moveId: Moves;

  constructor(moveId: Moves) {
    super(`TM${Utils.padInt(Object.keys(tmSpecies).indexOf(moveId.toString()) + 1, 3)} - ${allMoves[moveId].name}`, `Teach ${allMoves[moveId].name} to a Pokémon`, (_type, args) => new Modifiers.TmModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (pokemon.compatibleTms.indexOf(moveId) === -1 || pokemon.getMoveset().filter(m => m?.moveId === moveId).length)
          return PartyUiHandler.NoEffectMessage;
        return null;
      }, `tm_${Type[allMoves[moveId].type].toLowerCase()}`, 'tm');

    this.moveId = moveId;
  }
}

export class EvolutionItemModifierType extends PokemonModifierType implements GeneratedPersistentModifierType {
  public evolutionItem: EvolutionItem;

  constructor(evolutionItem: EvolutionItem) {
    super(Utils.toReadableString(EvolutionItem[evolutionItem]), `Causes certain Pokémon to evolve`, (_type, args) => new Modifiers.EvolutionItemModifier(this, (args[0] as PlayerPokemon).id),
    (pokemon: PlayerPokemon) => {
      if (pokemonEvolutions.hasOwnProperty(pokemon.species.speciesId) && pokemonEvolutions[pokemon.species.speciesId].filter(e => e.item === this.evolutionItem
        && (!e.condition || e.condition.predicate(pokemon))).length)
        return null;
      else if (pokemon.isFusion() && pokemonEvolutions.hasOwnProperty(pokemon.fusionSpecies.speciesId) && pokemonEvolutions[pokemon.fusionSpecies.speciesId].filter(e => e.item === this.evolutionItem
        && (!e.condition || e.condition.predicate(pokemon))).length)
        return null;

      return PartyUiHandler.NoEffectMessage;
    }, EvolutionItem[evolutionItem].toLowerCase());

    this.evolutionItem = evolutionItem;
  }

  getPregenArgs(): any[] {
    return [ this.evolutionItem ];
  }
}

export class FormChangeItemModifierType extends PokemonModifierType implements GeneratedPersistentModifierType {
  public formChangeItem: FormChangeItem;

  constructor(formChangeItem: FormChangeItem) {
    super(Utils.toReadableString(FormChangeItem[formChangeItem]), `Causes certain Pokémon to change form`, (_type, args) => new Modifiers.PokemonFormChangeItemModifier(this, (args[0] as PlayerPokemon).id, formChangeItem, true),
    (pokemon: PlayerPokemon) => {
      if (pokemonFormChanges.hasOwnProperty(pokemon.species.speciesId) && !!pokemonFormChanges[pokemon.species.speciesId].find(fc => fc.trigger.hasTriggerType(SpeciesFormChangeItemTrigger)
        && (fc.trigger as SpeciesFormChangeItemTrigger).item === this.formChangeItem))
        return null;

      return PartyUiHandler.NoEffectMessage;
    }, FormChangeItem[formChangeItem].toLowerCase());

    this.formChangeItem = formChangeItem;
  }

  getPregenArgs(): any[] {
    return [ this.formChangeItem ];
  }
}

export class FusePokemonModifierType extends PokemonModifierType {
  constructor(name: string, iconImage?: string) {
    super(name, 'Combines two Pokémon (transfers Ability, splits base stats and types, shares move pool)', (_type, args) => new Modifiers.FusePokemonModifier(this, (args[0] as PlayerPokemon).id, (args[1] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (pokemon.isFusion())
          return PartyUiHandler.NoEffectMessage;
        return null;
      }, iconImage);
  }
}

class AttackTypeBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  constructor() {
    super((party: Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs)
        return new AttackTypeBoosterModifierType(pregenArgs[0] as Type, 20);

      const attackMoveTypes = party.map(p => p.getMoveset().map(m => m.getMove()).filter(m => m instanceof AttackMove).map(m => m.type)).flat();
      if (!attackMoveTypes.length)
        return null;

      const attackMoveTypeWeights = new Map<Type, integer>();
      let totalWeight = 0;
      for (let t of attackMoveTypes) {
        if (attackMoveTypeWeights.has(t)) {
          if (attackMoveTypeWeights.get(t) < 3)
            attackMoveTypeWeights.set(t, attackMoveTypeWeights.get(t) + 1);
          else
            continue;
        } else
          attackMoveTypeWeights.set(t, 1);
        totalWeight++;
      }

      if (!totalWeight)
        return null;

      let type: Type;
      
      const randInt = Utils.randSeedInt(totalWeight);
      let weight = 0;

      for (let t of attackMoveTypeWeights.keys()) {
        const typeWeight = attackMoveTypeWeights.get(t);
        if (randInt <= weight + typeWeight) {
          type = t;
          break;
        }
        weight += typeWeight;
      }
      
      return new AttackTypeBoosterModifierType(type, 20);
    });
  }
}

class TmModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(tier: ModifierTier) {
    super((party: Pokemon[]) => {
      const partyMemberCompatibleTms = party.map(p => (p as PlayerPokemon).compatibleTms.filter(tm => !p.moveset.find(m => m.moveId === tm)));
      const tierUniqueCompatibleTms = partyMemberCompatibleTms.flat().filter(tm => tmPoolTiers[tm] === tier).filter(tm => !allMoves[tm].name.endsWith(' (N)')).filter((tm, i, array) => array.indexOf(tm) === i);
      if (!tierUniqueCompatibleTms.length)
        return null;
      const randTmIndex = Utils.randSeedInt(tierUniqueCompatibleTms.length);
      return new TmModifierType(tierUniqueCompatibleTms[randTmIndex]);
    });
  }
}

class EvolutionItemModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(rare: boolean) {
    super((party: Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs)
        return new EvolutionItemModifierType(pregenArgs[0] as EvolutionItem);

      const evolutionItemPool = [
        party.filter(p => pokemonEvolutions.hasOwnProperty(p.species.speciesId)).map(p => {
          const evolutions = pokemonEvolutions[p.species.speciesId];
          return evolutions.filter(e => e.item !== EvolutionItem.NONE && (e.evoFormKey === null || (e.preFormKey || '') === p.getFormKey()) && (!e.condition || e.condition.predicate(p)));
        }).flat(),
        party.filter(p => p.isFusion() && pokemonEvolutions.hasOwnProperty(p.fusionSpecies.speciesId)).map(p => {
          const evolutions = pokemonEvolutions[p.fusionSpecies.speciesId];
          return evolutions.filter(e => e.item !== EvolutionItem.NONE && (e.evoFormKey === null || (e.preFormKey || '') === p.getFusionFormKey()) && (!e.condition || e.condition.predicate(p)));
        }).flat()
      ].flat().flatMap(e => e.item).filter(i => (i > 50) === rare);

      if (!evolutionItemPool.length)
        return null;

      return new EvolutionItemModifierType(evolutionItemPool[Utils.randSeedInt(evolutionItemPool.length)]);
    });
  }
}

class FormChangeItemModifierTypeGenerator extends ModifierTypeGenerator {
  constructor() {
    super((party: Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs)
        return new FormChangeItemModifierType(pregenArgs[0] as FormChangeItem);

      const formChangeItemPool = party.filter(p => pokemonFormChanges.hasOwnProperty(p.species.speciesId)).map(p => {
        const formChanges = pokemonFormChanges[p.species.speciesId];
        return formChanges.filter(fc => ((fc.formKey.indexOf(SpeciesFormKey.MEGA) === -1 && fc.formKey.indexOf(SpeciesFormKey.PRIMAL) === -1) || party[0].scene.getModifiers(Modifiers.MegaEvolutionAccessModifier).length)
          && ((fc.formKey.indexOf(SpeciesFormKey.GIGANTAMAX) === -1 && fc.formKey.indexOf(SpeciesFormKey.ETERNAMAX) === -1) || party[0].scene.getModifiers(Modifiers.GigantamaxAccessModifier).length))
          .map(fc => fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger)
          .filter(t => t && t.active && !p.scene.findModifier(m => m instanceof Modifiers.PokemonFormChangeItemModifier && m.pokemonId === p.id && m.formChangeItem === t.item));
      }).flat().flatMap(fc => fc.item);

      if (!formChangeItemPool.length)
        return null;

      return new FormChangeItemModifierType(formChangeItemPool[Utils.randSeedInt(formChangeItemPool.length)]);
    });
  }
}

export class TerastallizeModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  private teraType: Type;

  constructor(teraType: Type) {
    super(`${Utils.toReadableString(Type[teraType])} Tera Shard`, `${Utils.toReadableString(Type[teraType])} Terastallizes the holder for up to 10 battles`, (type, args) => new Modifiers.TerastallizeModifier(type as TerastallizeModifierType, (args[0] as Pokemon).id, teraType), null, 'tera_shard');

    this.teraType = teraType;
  }

  getPregenArgs(): any[] {
    return [ this.teraType ];
  }
}

export class ContactHeldItemTransferChanceModifierType extends PokemonHeldItemModifierType {
  constructor(name: string, chancePercent: integer, iconImage?: string, group?: string, soundName?: string) {
    super(name, `Upon attacking, there is a ${chancePercent}% chance the foe's held item will be stolen.`, (type, args) => new Modifiers.ContactHeldItemTransferChanceModifier(type, (args[0] as Pokemon).id, chancePercent), iconImage, group, soundName);
  }
}

export class TurnHeldItemTransferModifierType extends PokemonHeldItemModifierType {
  constructor(name: string, iconImage?: string, group?: string, soundName?: string) {
    super(name, 'Every turn, the holder acquires one held item from the foe.', (type, args) => new Modifiers.TurnHeldItemTransferModifier(type, (args[0] as Pokemon).id), iconImage, group, soundName);
  }
}

export class EnemyAttackStatusEffectChanceModifierType extends ModifierType {
  constructor(name: string, chancePercent: integer, effect: StatusEffect, iconImage?: string) {
    super(name, `Adds a ${chancePercent}% chance to inflict ${getStatusEffectDescriptor(effect)} with attack moves`, (type, args) => new Modifiers.EnemyAttackStatusEffectChanceModifier(type, effect, chancePercent), iconImage, 'enemy_status_chance')
  }
}

export class EnemyEndureChanceModifierType extends ModifierType {
  constructor(name: string, chancePercent: number, iconImage?: string) {
    super(name, `Adds a ${chancePercent}% chance of enduring a hit`, (type, _args) => new Modifiers.EnemyEndureChanceModifier(type, chancePercent), iconImage, 'enemy_endure');
  }
}

export type ModifierTypeFunc = () => ModifierType;
type WeightedModifierTypeWeightFunc = (party: Pokemon[], rerollCount?: integer) => integer;

class WeightedModifierType {
  public modifierType: ModifierType;
  public weight: integer | WeightedModifierTypeWeightFunc;
  public maxWeight: integer;

  constructor(modifierTypeFunc: ModifierTypeFunc, weight: integer | WeightedModifierTypeWeightFunc, maxWeight?: integer) {
    this.modifierType = modifierTypeFunc();
    this.modifierType.id = Object.keys(modifierTypes).find(k => modifierTypes[k] === modifierTypeFunc);
    this.weight = weight;
    this.maxWeight = maxWeight || (!(weight instanceof Function) ? weight : 0);
  }

  setTier(tier: ModifierTier) {
    this.modifierType.setTier(tier);
  }
}

export const modifierTypes = {
  POKEBALL: () => new AddPokeballModifierType(PokeballType.POKEBALL, 5, 'pb'),
  GREAT_BALL: () => new AddPokeballModifierType(PokeballType.GREAT_BALL, 5, 'gb'),
  ULTRA_BALL: () => new AddPokeballModifierType(PokeballType.ULTRA_BALL, 5, 'ub'),
  ROGUE_BALL: () => new AddPokeballModifierType(PokeballType.ROGUE_BALL, 5, 'rb'),
  MASTER_BALL: () => new AddPokeballModifierType(PokeballType.MASTER_BALL, 1, 'mb'),

  RARE_CANDY: () => new PokemonLevelIncrementModifierType('Rare Candy'),
  RARER_CANDY: () => new AllPokemonLevelIncrementModifierType('Rarer Candy'),

  EVOLUTION_ITEM: () => new EvolutionItemModifierTypeGenerator(false),
  RARE_EVOLUTION_ITEM: () => new EvolutionItemModifierTypeGenerator(true),
  FORM_CHANGE_ITEM: () => new FormChangeItemModifierTypeGenerator(),

  MEGA_BRACELET: () => new ModifierType('Mega Bracelet', 'Mega Stones become available.', (type, _args) => new Modifiers.MegaEvolutionAccessModifier(type)),
  DYNAMAX_BAND: () => new ModifierType('Dynamax Band', 'Max Mushrooms become available.', (type, _args) => new Modifiers.GigantamaxAccessModifier(type)),
  TERA_ORB: () => new ModifierType('Tera Orb', 'Tera Shards become available.', (type, _args) => new Modifiers.TerastallizeAccessModifier(type)),

  MAP: () => new ModifierType('Map', 'Allows you to choose your destination at a crossroads', (type, _args) => new Modifiers.MapModifier(type)),

  POTION: () => new PokemonHpRestoreModifierType('Potion', 20, 10),
  SUPER_POTION: () => new PokemonHpRestoreModifierType('Super Potion', 50, 25),
  HYPER_POTION: () => new PokemonHpRestoreModifierType('Hyper Potion', 200, 50),
  MAX_POTION: () => new PokemonHpRestoreModifierType('Max Potion', 0, 100),
  FULL_RESTORE: () => new PokemonHpRestoreModifierType('Full Restore', 0, 100, true),
  
  REVIVE: () => new PokemonReviveModifierType('Revive', 50),
  MAX_REVIVE: () => new PokemonReviveModifierType('Max Revive', 100),

  FULL_HEAL: () => new PokemonStatusHealModifierType('Full Heal'),

  SACRED_ASH: () => new AllPokemonFullReviveModifierType('Sacred Ash'),

  REVIVER_SEED: () => new PokemonHeldItemModifierType('Reviver Seed', 'Revives the holder for 1/2 HP upon fainting',
    (type, args) => new Modifiers.PokemonInstantReviveModifier(type, (args[0] as Pokemon).id)),

  ETHER: () => new PokemonPpRestoreModifierType('Ether', 10),
  MAX_ETHER: () => new PokemonPpRestoreModifierType('Max Ether', -1),

  ELIXIR: () => new PokemonAllMovePpRestoreModifierType('Elixir', 10),
  MAX_ELIXIR: () => new PokemonAllMovePpRestoreModifierType('Max Elixir', -1),

  PP_UP: () => new PokemonPpUpModifierType('PP Up', 1),
  PP_MAX: () => new PokemonPpUpModifierType('PP Max', 3),

  /*REPEL: () => new DoubleBattleChanceBoosterModifierType('Repel', 5),
  SUPER_REPEL: () => new DoubleBattleChanceBoosterModifierType('Super Repel', 10),
  MAX_REPEL: () => new DoubleBattleChanceBoosterModifierType('Max Repel', 25),*/

  LURE: () => new DoubleBattleChanceBoosterModifierType('Lure', 5),
  SUPER_LURE: () => new DoubleBattleChanceBoosterModifierType('Super Lure', 10),
  MAX_LURE: () => new DoubleBattleChanceBoosterModifierType('Max Lure', 25),

  TEMP_STAT_BOOSTER: () => new ModifierTypeGenerator((party: Pokemon[], pregenArgs?: any[]) => {
    if (pregenArgs)
      return new TempBattleStatBoosterModifierType(pregenArgs[0] as TempBattleStat);
    const randTempBattleStat = Utils.randSeedInt(6) as TempBattleStat;
    return new TempBattleStatBoosterModifierType(randTempBattleStat);
  }),
  DIRE_HIT: () => new TempBattleStatBoosterModifierType(TempBattleStat.CRIT),

  BASE_STAT_BOOSTER: () => new ModifierTypeGenerator((party: Pokemon[], pregenArgs?: any[]) => {
    if (pregenArgs) {
      const stat = pregenArgs[0] as Stat;
      return new PokemonBaseStatBoosterModifierType(getBaseStatBoosterItemName(stat), stat);
    }
    const randStat = Utils.randSeedInt(6) as Stat;
    return new PokemonBaseStatBoosterModifierType(getBaseStatBoosterItemName(randStat), randStat);
  }),

  ATTACK_TYPE_BOOSTER: () => new AttackTypeBoosterModifierTypeGenerator(),

  MINT: () => new ModifierTypeGenerator((party: Pokemon[], pregenArgs?: any[]) => {
    if (pregenArgs)
      return new PokemonNatureChangeModifierType(pregenArgs[0] as Nature);
    return new PokemonNatureChangeModifierType(Utils.randSeedInt(Utils.getEnumValues(Nature).length) as Nature);
  }),

  TERA_SHARD: () => new ModifierTypeGenerator((party: Pokemon[], pregenArgs?: any[]) => {
    if (pregenArgs)
      return new TerastallizeModifierType(pregenArgs[0] as Type);
    if (!party[0].scene.getModifiers(Modifiers.TerastallizeAccessModifier).length)
      return null;
    let type: Type;
    if (!Utils.randSeedInt(3)) {
      const partyMemberTypes = party.map(p => p.getTypes(false, false, true)).flat();
      type = Utils.randSeedItem(partyMemberTypes);
    } else
      type = Utils.randSeedInt(64) ? Utils.randSeedInt(18) as Type : Type.STELLAR;
    return new TerastallizeModifierType(type);
  }),

  BERRY: () => new ModifierTypeGenerator((party: Pokemon[], pregenArgs?: any[]) => {
    if (pregenArgs)
      return new BerryModifierType(pregenArgs[0] as BerryType);
    const berryTypes = Utils.getEnumValues(BerryType);
    let randBerryType: BerryType;
    let rand = Utils.randSeedInt(12);
    if (rand < 2)
      randBerryType = BerryType.SITRUS;
    else if (rand < 4)
      randBerryType = BerryType.LUM;
    else if (rand < 6)
      randBerryType = BerryType.LEPPA;
    else
      randBerryType = berryTypes[Utils.randSeedInt(berryTypes.length - 3) + 2];
    return new BerryModifierType(randBerryType);
  }),

  TM_COMMON: () => new TmModifierTypeGenerator(ModifierTier.COMMON),
  TM_GREAT: () => new TmModifierTypeGenerator(ModifierTier.GREAT),
  TM_ULTRA: () => new TmModifierTypeGenerator(ModifierTier.ULTRA),

  MEMORY_MUSHROOM: () => new RememberMoveModifierType('Memory Mushroom', 'Recall one Pokémon\'s forgotten move', 'big_mushroom'),

  EXP_SHARE: () => new ModifierType('EXP. All', 'Non-participants receive 20% of a single participant\'s EXP. Points.',
    (type, _args) => new Modifiers.ExpShareModifier(type), 'exp_share'),
  EXP_BALANCE: () => new ModifierType('EXP. Balance', 'Weighs EXP. Points received from battles towards lower-leveled party members',
    (type, _args) => new Modifiers.ExpBalanceModifier(type)),

  OVAL_CHARM: () => new ModifierType('Oval Charm', 'When multiple Pokémon participate in a battle, each gets an extra 10% of the total EXP.',
    (type, _args) => new Modifiers.MultipleParticipantExpBonusModifier(type)),

  EXP_CHARM: () => new ExpBoosterModifierType('EXP. Charm', 25),
  SUPER_EXP_CHARM: () => new ExpBoosterModifierType('Super EXP. Charm', 60),
  GOLDEN_EXP_CHARM: () => new ExpBoosterModifierType('Golden EXP. Charm', 100),

  LUCKY_EGG: () => new PokemonExpBoosterModifierType('Lucky Egg', 40),
  GOLDEN_EGG: () => new PokemonExpBoosterModifierType('Golden Egg', 100),

  SOOTHE_BELL: () => new PokemonFriendshipBoosterModifierType('Soothe Bell'),

  SOUL_DEW: () => new PokemonHeldItemModifierType('Soul Dew', 'Increases the influence of a Pokémon\'s nature on its stats by 10% (additive)', (type, args) => new Modifiers.PokemonNatureWeightModifier(type, (args[0] as Pokemon).id)),

  NUGGET: () => new MoneyRewardModifierType('Nugget', 1, 'small'),
  BIG_NUGGET: () => new MoneyRewardModifierType('Big Nugget', 2.5, 'moderate'),
  RELIC_GOLD: () => new MoneyRewardModifierType('Relic Gold', 10, 'large'),

  AMULET_COIN: () => new ModifierType('Amulet Coin', 'Increases money rewards by 20%', (type, _args) => new Modifiers.MoneyMultiplierModifier(type)),
  GOLDEN_PUNCH: () => new PokemonHeldItemModifierType('Golden Punch', 'Grants 50% of damage inflicted as money', (type, args) => new Modifiers.DamageMoneyRewardModifier(type, (args[0] as Pokemon).id)),
  COIN_CASE: () => new ModifierType('Coin Case', 'After every 10th battle, receive 10% of your money in interest.', (type, _args) => new Modifiers.MoneyInterestModifier(type)),

  LOCK_CAPSULE: () => new ModifierType('Lock Capsule', 'Allows you to lock item rarities when rerolling items', (type, _args) => new Modifiers.LockModifierTiersModifier(type), 'lock_capsule'),

  GRIP_CLAW: () => new ContactHeldItemTransferChanceModifierType('Grip Claw', 10),
  WIDE_LENS: () => new PokemonMoveAccuracyBoosterModifierType('Wide Lens', 5, 'wide_lens'),

  MULTI_LENS: () => new PokemonMultiHitModifierType('Multi Lens', 'zoom_lens'),

  HEALING_CHARM: () => new ModifierType('Healing Charm', 'Increases the effectiveness of HP restoring moves and items by 10% (excludes Revives)',
    (type, _args) => new Modifiers.HealingBoosterModifier(type, 1.1), 'healing_charm'),
  CANDY_JAR: () => new ModifierType('Candy Jar', 'Increases the number of levels added by Rare Candy items by 1', (type, _args) => new Modifiers.LevelIncrementBoosterModifier(type)),

  BERRY_POUCH: () => new ModifierType('Berry Pouch', 'Adds a 25% chance that a used berry will not be consumed',
    (type, _args) => new Modifiers.PreserveBerryModifier(type)),

  FOCUS_BAND: () => new PokemonHeldItemModifierType('Focus Band', 'Adds a 10% chance to survive with 1 HP after being damaged enough to faint',
    (type, args) => new Modifiers.SurviveDamageModifier(type, (args[0] as Pokemon).id)),

  KINGS_ROCK: () => new PokemonHeldItemModifierType('King\'s Rock', 'Adds a 10% chance an attack move will cause the opponent to flinch',
    (type, args) => new Modifiers.FlinchChanceModifier(type, (args[0] as Pokemon).id)),

  LEFTOVERS: () => new PokemonHeldItemModifierType('Leftovers', 'Heals 1/16 of a Pokémon\'s maximum HP every turn',
    (type, args) => new Modifiers.TurnHealModifier(type, (args[0] as Pokemon).id)),
  SHELL_BELL: () => new PokemonHeldItemModifierType('Shell Bell', 'Heals 1/8 of a Pokémon\'s dealt damage',
    (type, args) => new Modifiers.HitHealModifier(type, (args[0] as Pokemon).id)),

  BATON: () => new PokemonHeldItemModifierType('Baton', 'Allows passing along effects when switching Pokémon, which also bypasses traps',
    (type, args) => new Modifiers.SwitchEffectTransferModifier(type, (args[0] as Pokemon).id), 'stick'),

  SHINY_CHARM: () => new ModifierType('Shiny Charm', 'Dramatically increases the chance of a wild Pokémon being Shiny', (type, _args) => new Modifiers.ShinyRateBoosterModifier(type)),
  ABILITY_CHARM: () => new ModifierType('Ability Charm', 'Dramatically increases the chance of a wild Pokémon having a Hidden Ability', (type, _args) => new Modifiers.HiddenAbilityRateBoosterModifier(type)),

  IV_SCANNER: () => new ModifierType('IV Scanner', 'Allows scanning the IVs of wild Pokémon. 2 IVs are revealed per stack. The best IVs are shown first.', (type, _args) => new Modifiers.IvScannerModifier(type), 'scanner'),

  DNA_SPLICERS: () => new FusePokemonModifierType('DNA Splicers'),

  MINI_BLACK_HOLE: () => new TurnHeldItemTransferModifierType('Mini Black Hole'),
  
  VOUCHER: () => new AddVoucherModifierType(VoucherType.REGULAR, 1),
  VOUCHER_PLUS: () => new AddVoucherModifierType(VoucherType.PLUS, 1),
  VOUCHER_PREMIUM: () => new AddVoucherModifierType(VoucherType.PREMIUM, 1),

  GOLDEN_POKEBALL: () => new ModifierType(`Golden ${getPokeballName(PokeballType.POKEBALL)}`, 'Adds 1 extra item option at the end of every battle',
    (type, _args) => new Modifiers.ExtraModifierModifier(type), 'pb_gold', null, 'pb_bounce_1'),

  ENEMY_DAMAGE_BOOSTER: () => new ModifierType('Damage Token', 'Increases damage by 5%', (type, _args) => new Modifiers.EnemyDamageBoosterModifier(type, 5), 'wl_item_drop'),
  ENEMY_DAMAGE_REDUCTION: () => new ModifierType('Protection Token', 'Reduces incoming damage by 2.5%', (type, _args) => new Modifiers.EnemyDamageReducerModifier(type, 2.5), 'wl_guard_spec'),
  //ENEMY_SUPER_EFFECT_BOOSTER: () => new ModifierType('Type Advantage Token', 'Increases damage of super effective attacks by 30%', (type, _args) => new Modifiers.EnemySuperEffectiveDamageBoosterModifier(type, 30), 'wl_custom_super_effective'),
  ENEMY_HEAL: () => new ModifierType('Recovery Token', 'Heals 2% of max HP every turn', (type, _args) => new Modifiers.EnemyTurnHealModifier(type, 2), 'wl_potion'),
  ENEMY_ATTACK_POISON_CHANCE: () => new EnemyAttackStatusEffectChanceModifierType('Poison Token', 10, StatusEffect.POISON, 'wl_antidote'),
  ENEMY_ATTACK_PARALYZE_CHANCE: () => new EnemyAttackStatusEffectChanceModifierType('Paralyze Token', 10, StatusEffect.PARALYSIS, 'wl_paralyze_heal'),
  ENEMY_ATTACK_SLEEP_CHANCE: () => new EnemyAttackStatusEffectChanceModifierType('Sleep Token', 10, StatusEffect.SLEEP, 'wl_awakening'),
  ENEMY_ATTACK_FREEZE_CHANCE: () => new EnemyAttackStatusEffectChanceModifierType('Freeze Token', 10, StatusEffect.FREEZE, 'wl_ice_heal'),
  ENEMY_ATTACK_BURN_CHANCE: () => new EnemyAttackStatusEffectChanceModifierType('Burn Token', 10, StatusEffect.BURN, 'wl_burn_heal'),
  ENEMY_STATUS_EFFECT_HEAL_CHANCE: () => new ModifierType('Full Heal Token', 'Adds a 10% chance every turn to heal a status condition', (type, _args) => new Modifiers.EnemyStatusEffectHealChanceModifier(type, 10), 'wl_full_heal'),
  ENEMY_ENDURE_CHANCE: () => new EnemyEndureChanceModifierType('Endure Token', 2.5, 'wl_reset_urge'),
  ENEMY_FUSED_CHANCE: () => new ModifierType('Fusion Token', 'Adds a 1% chance that a wild Pokémon will be a fusion', (type, _args) => new Modifiers.EnemyFusionChanceModifier(type, 1), 'wl_custom_spliced'),
};

interface ModifierPool {
  [tier: string]: WeightedModifierType[]
}

const modifierPool: ModifierPool = {
  [ModifierTier.COMMON]: [
    new WeightedModifierType(modifierTypes.POKEBALL, 6),
    new WeightedModifierType(modifierTypes.RARE_CANDY, 2),
    new WeightedModifierType(modifierTypes.POTION, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.getInverseHp() >= 10 || p.getHpRatio() <= 0.875).length, 3);
      return thresholdPartyMemberCount * 3;
    }, 9),
    new WeightedModifierType(modifierTypes.SUPER_POTION, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.getInverseHp() >= 25 || p.getHpRatio() <= 0.75).length, 3);
      return thresholdPartyMemberCount;
    }, 3),
    new WeightedModifierType(modifierTypes.ETHER, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.hp && p.getMoveset().filter(m => (m.getMove().pp - m.ppUsed) <= 5).length).length, 3);
      return thresholdPartyMemberCount * 3;
    }, 9),
    new WeightedModifierType(modifierTypes.MAX_ETHER, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.hp && p.getMoveset().filter(m => (m.getMove().pp - m.ppUsed) <= 5).length).length, 3);
      return thresholdPartyMemberCount;
    }, 3),
    new WeightedModifierType(modifierTypes.LURE, 2),
    new WeightedModifierType(modifierTypes.TEMP_STAT_BOOSTER, 4),
    new WeightedModifierType(modifierTypes.BERRY, 2),
    new WeightedModifierType(modifierTypes.TM_COMMON, 1),
  ].map(m => { m.setTier(ModifierTier.COMMON); return m; }),
  [ModifierTier.GREAT]: [
    new WeightedModifierType(modifierTypes.GREAT_BALL, 6),
    new WeightedModifierType(modifierTypes.FULL_HEAL, (party: Pokemon[]) => {
      const statusEffectPartyMemberCount = Math.min(party.filter(p => p.hp && !!p.status).length, 3);
      return statusEffectPartyMemberCount * 6;
    }, 18),
    new WeightedModifierType(modifierTypes.REVIVE, (party: Pokemon[]) => {
      const faintedPartyMemberCount = Math.min(party.filter(p => p.isFainted()).length, 3);
      return faintedPartyMemberCount * 9;
    }, 27),
    new WeightedModifierType(modifierTypes.MAX_REVIVE, (party: Pokemon[]) => {
      const faintedPartyMemberCount = Math.min(party.filter(p => p.isFainted()).length, 3);
      return faintedPartyMemberCount * 3;
    }, 9),
    new WeightedModifierType(modifierTypes.SACRED_ASH, (party: Pokemon[]) => {
      return party.filter(p => p.isFainted()).length >= Math.ceil(party.length / 2) ? 1 : 0;
    }, 1),
    new WeightedModifierType(modifierTypes.HYPER_POTION, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.getInverseHp() >= 100 || p.getHpRatio() <= 0.625).length, 3);
      return thresholdPartyMemberCount * 3;
    }, 9),
    new WeightedModifierType(modifierTypes.MAX_POTION, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.getInverseHp() >= 150 || p.getHpRatio() <= 0.5).length, 3);
      return thresholdPartyMemberCount;
    }, 3),
    new WeightedModifierType(modifierTypes.FULL_RESTORE, (party: Pokemon[]) => {
      const statusEffectPartyMemberCount = Math.min(party.filter(p => p.hp && !!p.status).length, 3);
      const thresholdPartyMemberCount = Math.floor((Math.min(party.filter(p => p.getInverseHp() >= 150 || p.getHpRatio() <= 0.5).length, 3) + statusEffectPartyMemberCount) / 2);
      return thresholdPartyMemberCount;
    }, 3),
    new WeightedModifierType(modifierTypes.ELIXIR, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.hp && p.getMoveset().filter(m => (m.getMove().pp - m.ppUsed) <= 5).length).length, 3);
      return thresholdPartyMemberCount * 3;
    }, 9),
    new WeightedModifierType(modifierTypes.MAX_ELIXIR, (party: Pokemon[]) => {
      const thresholdPartyMemberCount = Math.min(party.filter(p => p.hp && p.getMoveset().filter(m => (m.getMove().pp - m.ppUsed) <= 5).length).length, 3);
      return thresholdPartyMemberCount;
    }, 3),
    new WeightedModifierType(modifierTypes.DIRE_HIT, 4),
    new WeightedModifierType(modifierTypes.SUPER_LURE, 4),
    new WeightedModifierType(modifierTypes.NUGGET, 5),
    new WeightedModifierType(modifierTypes.EVOLUTION_ITEM, (party: Pokemon[]) => {
      return Math.min(Math.ceil(party[0].scene.currentBattle.waveIndex / 15), 8);
    }, 8),
    new WeightedModifierType(modifierTypes.MAP, (party: Pokemon[]) => party[0].scene.gameMode.isClassic ? 1 : 0, 1),
    new WeightedModifierType(modifierTypes.TM_GREAT, 2),
    new WeightedModifierType(modifierTypes.MEMORY_MUSHROOM, (party: Pokemon[]) => {
      if (!party.find(p => p.getLearnableLevelMoves().length))
        return 0;
      const highestPartyLevel = party.map(p => p.level).reduce((highestLevel: integer, level: integer) => Math.max(highestLevel, level), 1);
      return Math.min(Math.ceil(highestPartyLevel / 20), 4);
    }, 4),
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 3),
    new WeightedModifierType(modifierTypes.TERA_SHARD, 1),
    new WeightedModifierType(modifierTypes.DNA_SPLICERS, (party: Pokemon[]) => party[0].scene.gameMode.isSplicedOnly && party.filter(p => !p.fusionSpecies).length > 1 ? 4 : 0),
  ].map(m => { m.setTier(ModifierTier.GREAT); return m; }),
  [ModifierTier.ULTRA]: [
    new WeightedModifierType(modifierTypes.ULTRA_BALL, 24),
    new WeightedModifierType(modifierTypes.MAX_LURE, 4),
    new WeightedModifierType(modifierTypes.BIG_NUGGET, 12),
    new WeightedModifierType(modifierTypes.PP_UP, 9),
    new WeightedModifierType(modifierTypes.PP_MAX, 3),
    new WeightedModifierType(modifierTypes.MINT, 4),
    new WeightedModifierType(modifierTypes.RARE_EVOLUTION_ITEM, (party: Pokemon[]) => Math.min(Math.ceil(party[0].scene.currentBattle.waveIndex / 15) * 4, 32), 32),
    new WeightedModifierType(modifierTypes.AMULET_COIN, 3),
    new WeightedModifierType(modifierTypes.REVIVER_SEED, 4),
    new WeightedModifierType(modifierTypes.CANDY_JAR, 5),
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 10),
    new WeightedModifierType(modifierTypes.TM_ULTRA, 8),
    new WeightedModifierType(modifierTypes.RARER_CANDY, 4),
    new WeightedModifierType(modifierTypes.GOLDEN_PUNCH, 2),
    new WeightedModifierType(modifierTypes.IV_SCANNER, 4),
    new WeightedModifierType(modifierTypes.EXP_CHARM, 8),
    new WeightedModifierType(modifierTypes.EXP_SHARE, 12),
    new WeightedModifierType(modifierTypes.EXP_BALANCE, 4),
    new WeightedModifierType(modifierTypes.TERA_ORB, (party: Pokemon[]) => Math.min(Math.max(Math.floor(party[0].scene.currentBattle.waveIndex / 50) * 2, 1), 4), 4),
    new WeightedModifierType(modifierTypes.VOUCHER, (party: Pokemon[], rerollCount: integer) => !party[0].scene.gameMode.isDaily ? Math.max(3 - rerollCount, 0) : 0, 3),
  ].map(m => { m.setTier(ModifierTier.ULTRA); return m; }),
  [ModifierTier.ROGUE]: [
    new WeightedModifierType(modifierTypes.ROGUE_BALL, 24),
    new WeightedModifierType(modifierTypes.RELIC_GOLD, 2),
    new WeightedModifierType(modifierTypes.LEFTOVERS, 3),
    new WeightedModifierType(modifierTypes.SHELL_BELL, 3),
    new WeightedModifierType(modifierTypes.BERRY_POUCH, 4),
    new WeightedModifierType(modifierTypes.GRIP_CLAW, 5),
    new WeightedModifierType(modifierTypes.WIDE_LENS, 4),
    new WeightedModifierType(modifierTypes.BATON, 2),
    new WeightedModifierType(modifierTypes.SOUL_DEW, 8),
    //new WeightedModifierType(modifierTypes.OVAL_CHARM, 6),
    new WeightedModifierType(modifierTypes.SOOTHE_BELL, 4),
    new WeightedModifierType(modifierTypes.ABILITY_CHARM, 6),
    new WeightedModifierType(modifierTypes.FOCUS_BAND, 5),
    new WeightedModifierType(modifierTypes.KINGS_ROCK, 3),
    new WeightedModifierType(modifierTypes.LOCK_CAPSULE, 3),
    new WeightedModifierType(modifierTypes.SUPER_EXP_CHARM, 10),
    new WeightedModifierType(modifierTypes.FORM_CHANGE_ITEM, 18),
    new WeightedModifierType(modifierTypes.MEGA_BRACELET, (party: Pokemon[]) => Math.min(Math.ceil(party[0].scene.currentBattle.waveIndex / 50), 4) * 8, 32),
    new WeightedModifierType(modifierTypes.DYNAMAX_BAND, (party: Pokemon[]) => Math.min(Math.ceil(party[0].scene.currentBattle.waveIndex / 50), 4) * 8, 32),
  ].map(m => { m.setTier(ModifierTier.ROGUE); return m; }),
  [ModifierTier.MASTER]: [
    new WeightedModifierType(modifierTypes.MASTER_BALL, 24),
    new WeightedModifierType(modifierTypes.SHINY_CHARM, 14),
    new WeightedModifierType(modifierTypes.HEALING_CHARM, 18),
    new WeightedModifierType(modifierTypes.MULTI_LENS, 18),
    new WeightedModifierType(modifierTypes.VOUCHER_PLUS, (party: Pokemon[], rerollCount: integer) => !party[0].scene.gameMode.isDaily ? Math.max(9 - rerollCount * 3, 0) : 0, 9),
    new WeightedModifierType(modifierTypes.DNA_SPLICERS, (party: Pokemon[]) => !party[0].scene.gameMode.isSplicedOnly && party.filter(p => !p.fusionSpecies).length > 1 ? 24 : 0, 24),
    new WeightedModifierType(modifierTypes.MINI_BLACK_HOLE, (party: Pokemon[]) => party[0].scene.gameData.unlocks[Unlockables.MINI_BLACK_HOLE] ? 1 : 0, 1),
  ].map(m => { m.setTier(ModifierTier.MASTER); return m; })
};

const wildModifierPool: ModifierPool = {
  [ModifierTier.COMMON]: [
    new WeightedModifierType(modifierTypes.BERRY, 1)
  ].map(m => { m.setTier(ModifierTier.COMMON); return m; }),
  [ModifierTier.GREAT]: [
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 1)
  ].map(m => { m.setTier(ModifierTier.GREAT); return m; }),
  [ModifierTier.ULTRA]: [
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 10),
  ].map(m => { m.setTier(ModifierTier.ULTRA); return m; }),
  [ModifierTier.ROGUE]: [
    new WeightedModifierType(modifierTypes.LUCKY_EGG, 4),
  ].map(m => { m.setTier(ModifierTier.ROGUE); return m; }),
  [ModifierTier.MASTER]: [
    new WeightedModifierType(modifierTypes.GOLDEN_EGG, 1)
  ].map(m => { m.setTier(ModifierTier.MASTER); return m; })
};

const trainerModifierPool: ModifierPool = {
  [ModifierTier.COMMON]: [
    new WeightedModifierType(modifierTypes.BERRY, 8),
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 3)
  ].map(m => { m.setTier(ModifierTier.COMMON); return m; }),
  [ModifierTier.GREAT]: [
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 3),
  ].map(m => { m.setTier(ModifierTier.GREAT); return m; }),
  [ModifierTier.ULTRA]: [
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 1),
  ].map(m => { m.setTier(ModifierTier.ULTRA); return m; }),
  [ModifierTier.ROGUE]: [
    new WeightedModifierType(modifierTypes.REVIVER_SEED, 2),
    new WeightedModifierType(modifierTypes.FOCUS_BAND, 2),
    new WeightedModifierType(modifierTypes.LUCKY_EGG, 4),
    new WeightedModifierType(modifierTypes.GRIP_CLAW, 1),
    new WeightedModifierType(modifierTypes.WIDE_LENS, 1),
  ].map(m => { m.setTier(ModifierTier.ROGUE); return m; }),
  [ModifierTier.MASTER]: [
    new WeightedModifierType(modifierTypes.KINGS_ROCK, 1),
    new WeightedModifierType(modifierTypes.LEFTOVERS, 1),
    new WeightedModifierType(modifierTypes.SHELL_BELL, 1),
  ].map(m => { m.setTier(ModifierTier.MASTER); return m; })
};

const enemyBuffModifierPool: ModifierPool = {
  [ModifierTier.COMMON]: [
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_BOOSTER, 10),
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_REDUCTION, 10),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_POISON_CHANCE, 2),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_PARALYZE_CHANCE, 2),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_SLEEP_CHANCE, 2),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_FREEZE_CHANCE, 2),
    new WeightedModifierType(modifierTypes.ENEMY_ATTACK_BURN_CHANCE, 2),
    new WeightedModifierType(modifierTypes.ENEMY_STATUS_EFFECT_HEAL_CHANCE, 10),
    new WeightedModifierType(modifierTypes.ENEMY_ENDURE_CHANCE, 5),
    new WeightedModifierType(modifierTypes.ENEMY_FUSED_CHANCE, 1)
  ].map(m => { m.setTier(ModifierTier.COMMON); return m; }),
  [ModifierTier.GREAT]: [
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_BOOSTER, 5),
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_REDUCTION, 5),
    new WeightedModifierType(modifierTypes.ENEMY_STATUS_EFFECT_HEAL_CHANCE, 5),
    new WeightedModifierType(modifierTypes.ENEMY_ENDURE_CHANCE, 5),
    new WeightedModifierType(modifierTypes.ENEMY_FUSED_CHANCE, 1)
  ].map(m => { m.setTier(ModifierTier.GREAT); return m; }),
  [ModifierTier.ULTRA]: [
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_BOOSTER, 10),
    new WeightedModifierType(modifierTypes.ENEMY_DAMAGE_REDUCTION, 10),
    new WeightedModifierType(modifierTypes.ENEMY_HEAL, 10),
    new WeightedModifierType(modifierTypes.ENEMY_STATUS_EFFECT_HEAL_CHANCE, 10),
    new WeightedModifierType(modifierTypes.ENEMY_ENDURE_CHANCE, 10),
    new WeightedModifierType(modifierTypes.ENEMY_FUSED_CHANCE, 5)
  ].map(m => { m.setTier(ModifierTier.ULTRA); return m; }),
  [ModifierTier.ROGUE]: [ ].map(m => { m.setTier(ModifierTier.ROGUE); return m; }),
  [ModifierTier.MASTER]: [ ].map(m => { m.setTier(ModifierTier.MASTER); return m; })
};

const dailyStarterModifierPool: ModifierPool = {
  [ModifierTier.COMMON]: [
    new WeightedModifierType(modifierTypes.BASE_STAT_BOOSTER, 1),
    new WeightedModifierType(modifierTypes.BERRY, 3),
  ].map(m => { m.setTier(ModifierTier.COMMON); return m; }),
  [ModifierTier.GREAT]: [
    new WeightedModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, 5),
  ].map(m => { m.setTier(ModifierTier.GREAT); return m; }),
  [ModifierTier.ULTRA]: [
    new WeightedModifierType(modifierTypes.REVIVER_SEED, 4),
    new WeightedModifierType(modifierTypes.SOOTHE_BELL, 1),
    new WeightedModifierType(modifierTypes.SOUL_DEW, 1),
    new WeightedModifierType(modifierTypes.GOLDEN_PUNCH, 1),
  ].map(m => { m.setTier(ModifierTier.ULTRA); return m; }),
  [ModifierTier.ROGUE]: [
    new WeightedModifierType(modifierTypes.GRIP_CLAW, 5),
    new WeightedModifierType(modifierTypes.BATON, 2),
    new WeightedModifierType(modifierTypes.FOCUS_BAND, 5),
    new WeightedModifierType(modifierTypes.KINGS_ROCK, 3),
  ].map(m => { m.setTier(ModifierTier.ROGUE); return m; }),
  [ModifierTier.MASTER]: [
    new WeightedModifierType(modifierTypes.LEFTOVERS, 1),
    new WeightedModifierType(modifierTypes.SHELL_BELL, 1),
  ].map(m => { m.setTier(ModifierTier.MASTER); return m; })
};

export function getModifierType(modifierTypeFunc: ModifierTypeFunc): ModifierType {
  const modifierType = modifierTypeFunc();
  if (!modifierType.id)
    modifierType.id = Object.keys(modifierTypes).find(k => modifierTypes[k] === modifierTypeFunc);
  return modifierType;
}

let modifierPoolThresholds = {};
let ignoredPoolIndexes = {};

let dailyStarterModifierPoolThresholds = {};
let ignoredDailyStarterPoolIndexes = {};

let enemyModifierPoolThresholds = {};
let enemyIgnoredPoolIndexes = {};

let enemyBuffModifierPoolThresholds = {};
let enemyBuffIgnoredPoolIndexes = {};

export function getModifierPoolForType(poolType: ModifierPoolType): ModifierPool {
  let pool: ModifierPool;
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      pool = modifierPool;
      break;
    case ModifierPoolType.WILD:
      pool = wildModifierPool;
      break;
    case ModifierPoolType.TRAINER:
      pool = trainerModifierPool;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      pool = enemyBuffModifierPool;
      break;
    case ModifierPoolType.DAILY_STARTER:
      pool = dailyStarterModifierPool;
      break;
  }
  return pool;
}

const tierWeights = [ 769 / 1024, 192 / 1024, 48 / 1024, 12 / 1024, 1 / 1024 ];

export function regenerateModifierPoolThresholds(party: Pokemon[], poolType: ModifierPoolType, rerollCount: integer = 0) {
  const pool = getModifierPoolForType(poolType);
 
  const ignoredIndexes = {};
  const modifierTableData = {};
  const thresholds = Object.fromEntries(new Map(Object.keys(pool).map(t => {
    ignoredIndexes[t] = [];
    const thresholds = new Map();
    const tierModifierIds: string[] = [];
    let tierMaxWeight = 0;
    let i = 0;
    pool[t].reduce((total: integer, modifierType: WeightedModifierType) => {
      const weightedModifierType = modifierType as WeightedModifierType;
      const existingModifiers = party[0].scene.findModifiers(m => (m.type.generatorId || m.type.id) === weightedModifierType.modifierType.id, poolType === ModifierPoolType.PLAYER);
      const itemModifierType = weightedModifierType.modifierType instanceof ModifierTypeGenerator
        ? weightedModifierType.modifierType.generateType(party)
        : weightedModifierType.modifierType;
      const weight = !existingModifiers.length
        || itemModifierType instanceof PokemonHeldItemModifierType
        || itemModifierType instanceof FormChangeItemModifierType
        || existingModifiers.find(m => m.stackCount < m.getMaxStackCount(party[0].scene, true))
        ? weightedModifierType.weight instanceof Function
          ? (weightedModifierType.weight as Function)(party, rerollCount)
          : weightedModifierType.weight as integer
        : 0;
      if (weightedModifierType.maxWeight) {
        const modifierId = weightedModifierType.modifierType.generatorId || weightedModifierType.modifierType.id;
        tierModifierIds.push(modifierId);
        const outputWeight = useMaxWeightForOutput ? weightedModifierType.maxWeight : weight;
        modifierTableData[modifierId] = { weight: outputWeight, tier: parseInt(t), tierPercent: 0, totalPercent: 0 };
        tierMaxWeight += outputWeight;
      }
      if (weight)
        total += weight;
      else {
        ignoredIndexes[t].push(i++);
        return total;
      }
      thresholds.set(total, i++);
      return total;
    }, 0);
    for (let id of tierModifierIds)
      modifierTableData[id].tierPercent = Math.floor((modifierTableData[id].weight / tierMaxWeight) * 10000) / 100;
    return [ t, Object.fromEntries(thresholds) ];
  })));
  for (let id of Object.keys(modifierTableData)) {
    modifierTableData[id].totalPercent = Math.floor(modifierTableData[id].tierPercent * tierWeights[modifierTableData[id].tier] * 100) / 100;
    modifierTableData[id].tier = ModifierTier[modifierTableData[id].tier];
  }
  if (outputModifierData)
    console.table(modifierTableData);
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      modifierPoolThresholds = thresholds;
      ignoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.WILD:
    case ModifierPoolType.TRAINER:
      enemyModifierPoolThresholds = thresholds;
      enemyIgnoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      enemyBuffModifierPoolThresholds = thresholds;
      enemyBuffIgnoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.DAILY_STARTER:
      dailyStarterModifierPoolThresholds = thresholds;
      ignoredDailyStarterPoolIndexes = ignoredIndexes;
      break;
  }
}

export function getModifierTypeFuncById(id: string): ModifierTypeFunc {
  return modifierTypes[id];
}

export function getPlayerModifierTypeOptions(count: integer, party: PlayerPokemon[], modifierTiers?: ModifierTier[]): ModifierTypeOption[] {
  const options: ModifierTypeOption[] = [];
  const retryCount = Math.min(count * 5, 50);
  new Array(count).fill(0).map((_, i) => {
    let candidate = getNewModifierTypeOption(party, ModifierPoolType.PLAYER, modifierTiers?.length > i ? modifierTiers[i] : undefined);
    let r = 0;
    while (options.length && ++r < retryCount && options.filter(o => o.type.name === candidate.type.name || o.type.group === candidate.type.group).length)
      candidate = getNewModifierTypeOption(party, ModifierPoolType.PLAYER, candidate.type.tier, candidate.upgradeCount);
    options.push(candidate);
  });
  return options;
}

export function getPlayerShopModifierTypeOptionsForWave(waveIndex: integer, baseCost: integer): ModifierTypeOption[] {
  if (!(waveIndex % 10))
    return [];

  const options = [
    [
      new ModifierTypeOption(modifierTypes.POTION(), 0, baseCost * 0.2),
      new ModifierTypeOption(modifierTypes.ETHER(), 0, baseCost * 0.4),
      new ModifierTypeOption(modifierTypes.REVIVE(), 0, baseCost * 2)
    ],
    [
      new ModifierTypeOption(modifierTypes.SUPER_POTION(), 0, baseCost * 0.45),
      new ModifierTypeOption(modifierTypes.FULL_HEAL(), 0, baseCost),
    ],
    [
      new ModifierTypeOption(modifierTypes.ELIXIR(), 0, baseCost),
      new ModifierTypeOption(modifierTypes.MAX_ETHER(), 0, baseCost)
    ],
    [
      new ModifierTypeOption(modifierTypes.HYPER_POTION(), 0, baseCost * 0.8),
      new ModifierTypeOption(modifierTypes.MAX_REVIVE(), 0, baseCost * 2.75)
    ],
    [
      new ModifierTypeOption(modifierTypes.MAX_POTION(), 0, baseCost * 1.5),
      new ModifierTypeOption(modifierTypes.MAX_ELIXIR(), 0, baseCost * 2.5)
    ],
    [
      new ModifierTypeOption(modifierTypes.FULL_RESTORE(), 0, baseCost * 2.25)
    ],
    [
      new ModifierTypeOption(modifierTypes.SACRED_ASH(), 0, baseCost * 10)
    ]
  ];
  return options.slice(0, Math.ceil(Math.max(waveIndex + 10, 0) / 30)).flat();
}

export function getEnemyBuffModifierForWave(tier: ModifierTier, enemyModifiers: Modifiers.PersistentModifier[], scene: BattleScene): Modifiers.EnemyPersistentModifier {
  const tierStackCount = tier === ModifierTier.ULTRA ? 5 : tier === ModifierTier.GREAT ? 3 : 1;
  const retryCount = 50;
  let candidate = getNewModifierTypeOption(null, ModifierPoolType.ENEMY_BUFF, tier);
  let r = 0;
  let matchingModifier: Modifiers.PersistentModifier;
  while (++r < retryCount && (matchingModifier = enemyModifiers.find(m => m.type.id === candidate.type.id)) && matchingModifier.getMaxStackCount(scene) < matchingModifier.stackCount + (r < 10 ? tierStackCount : 1))
    candidate = getNewModifierTypeOption(null, ModifierPoolType.ENEMY_BUFF, tier);

  const modifier = candidate.type.newModifier() as Modifiers.EnemyPersistentModifier;
  modifier.stackCount = tierStackCount;

  return modifier;
}

export function getEnemyModifierTypesForWave(waveIndex: integer, count: integer, party: EnemyPokemon[], poolType: ModifierPoolType.WILD | ModifierPoolType.TRAINER, upgradeChance: integer = 0): PokemonHeldItemModifierType[] {
  const ret = new Array(count).fill(0).map(() => getNewModifierTypeOption(party, poolType, undefined, upgradeChance && !Utils.randSeedInt(upgradeChance) ? 1 : 0).type as PokemonHeldItemModifierType);
  if (!(waveIndex % 1000))
    ret.push(getModifierType(modifierTypes.MINI_BLACK_HOLE) as PokemonHeldItemModifierType);
  return ret;
}

export function getDailyRunStarterModifiers(party: PlayerPokemon[]): Modifiers.PokemonHeldItemModifier[] {
  const ret: Modifiers.PokemonHeldItemModifier[] = [];
  for (let p of party) {
    for (let m = 0; m < 3; m++) {
      const tierValue = Utils.randSeedInt(64);
      const tier = tierValue > 25 ? ModifierTier.COMMON : tierValue > 12 ? ModifierTier.GREAT : tierValue > 4 ? ModifierTier.ULTRA : tierValue ? ModifierTier.ROGUE : ModifierTier.MASTER;
      const modifier = getNewModifierTypeOption(party, ModifierPoolType.DAILY_STARTER, tier).type.newModifier(p) as Modifiers.PokemonHeldItemModifier;
      ret.push(modifier);
    }
  }

  return ret;
}

function getNewModifierTypeOption(party: Pokemon[], poolType: ModifierPoolType, tier?: ModifierTier, upgradeCount?: integer, retryCount: integer = 0): ModifierTypeOption {
  const player = !poolType;
  const pool = getModifierPoolForType(poolType);
  let thresholds: object;
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      thresholds = modifierPoolThresholds;
      break;
    case ModifierPoolType.WILD:
      thresholds = enemyModifierPoolThresholds;
      break;
    case ModifierPoolType.TRAINER:
      thresholds = enemyModifierPoolThresholds;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      thresholds = enemyBuffModifierPoolThresholds;
      break;
    case ModifierPoolType.DAILY_STARTER:
      thresholds = dailyStarterModifierPoolThresholds;
      break;
  }
  if (tier === undefined) {
    const tierValue = Utils.randSeedInt(1024);
    if (!upgradeCount)
      upgradeCount = 0;
    if (player && tierValue) {
      const partyLuckValue = getPartyLuckValue(party);
      const upgradeOdds = Math.floor(128 / ((partyLuckValue + 4) / 4));
      let upgraded = false;
      do {
        upgraded = Utils.randSeedInt(upgradeOdds) < 4;
        if (upgraded)
          upgradeCount++;
      } while (upgraded);
    }
    tier = tierValue > 255 ? ModifierTier.COMMON : tierValue > 60 ? ModifierTier.GREAT : tierValue > 12 ? ModifierTier.ULTRA : tierValue ? ModifierTier.ROGUE : ModifierTier.MASTER;
    // Does this actually do anything?
    if (!upgradeCount)
      upgradeCount = Math.min(upgradeCount, ModifierTier.MASTER - tier);
    tier += upgradeCount;
    while (tier && (!modifierPool.hasOwnProperty(tier) || !modifierPool[tier].length)) {
      tier--;
      if (upgradeCount)
        upgradeCount--;
    }
  } else if (upgradeCount === undefined && player) {
    upgradeCount = 0;
    if (tier < ModifierTier.MASTER) {
      const partyShinyCount = party.filter(p => p.isShiny() && !p.isFainted()).length;
      const upgradeOdds = Math.floor(32 / ((partyShinyCount + 2) / 2));
      while (modifierPool.hasOwnProperty(tier + upgradeCount + 1) && modifierPool[tier + upgradeCount + 1].length) {
        if (!Utils.randSeedInt(upgradeOdds))
          upgradeCount++;
        else
          break;
      }
      tier += upgradeCount;
    }
  } else if (retryCount === 10 && tier) {
    retryCount = 0;
    tier--;
  }

  const tierThresholds = Object.keys(thresholds[tier]);
  const totalWeight = parseInt(tierThresholds[tierThresholds.length - 1]);
  const value = Utils.randSeedInt(totalWeight);
  let index: integer;
  for (let t of tierThresholds) {
    let threshold = parseInt(t);
    if (value < threshold) {
      index = thresholds[tier][threshold];
      break;
    }
  }

  if (index === undefined)
    return null;
  
  if (player)
    console.log(index, ignoredPoolIndexes[tier].filter(i => i <= index).length, ignoredPoolIndexes[tier])
  let modifierType: ModifierType = (pool[tier][index]).modifierType;
  if (modifierType instanceof ModifierTypeGenerator) {
    modifierType = (modifierType as ModifierTypeGenerator).generateType(party);
    if (modifierType === null) {
      if (player)
        console.log(ModifierTier[tier], upgradeCount);
      return getNewModifierTypeOption(party, poolType, tier, upgradeCount, ++retryCount);
    }
  }

  console.log(modifierType, !player ? '(enemy)' : '');

  return new ModifierTypeOption(modifierType as ModifierType, upgradeCount);
}

export function getDefaultModifierTypeForTier(tier: ModifierTier): ModifierType {
  let modifierType: ModifierType | WeightedModifierType = modifierPool[tier || ModifierTier.COMMON][0];
  if (modifierType instanceof WeightedModifierType)
    modifierType = (modifierType as WeightedModifierType).modifierType;
  return modifierType;
}

export class ModifierTypeOption {
  public type: ModifierType;
  public upgradeCount: integer;
  public cost: integer;

  constructor(type: ModifierType, upgradeCount: integer, cost: number = 0) {
    this.type = type;
    this.upgradeCount = upgradeCount;
    this.cost = Math.min(Math.round(cost), Number.MAX_SAFE_INTEGER);
  }
}

export function getPartyLuckValue(party: Pokemon[]): integer {
  return Phaser.Math.Clamp(party.map(p => p.isFainted() ? 0 : p.getLuck())
    .reduce((total: integer, value: integer) => total += value, 0), 0, 14);
}

export function getLuckString(luckValue: integer): string {
  return [ 'D', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'A++', 'S', 'S+', 'SS', 'SS+', 'SSS' ][luckValue];
}

export function getLuckTextTint(luckValue: integer): integer {
  const modifierTier = luckValue ? luckValue > 2 ? luckValue > 5 ? luckValue > 9 ? luckValue > 11 ? ModifierTier.LUXURY : ModifierTier.MASTER : ModifierTier.ROGUE : ModifierTier.ULTRA : ModifierTier.GREAT : ModifierTier.COMMON;
  return getModifierTierTextTint(modifierTier);
}
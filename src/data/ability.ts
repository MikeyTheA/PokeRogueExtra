import Pokemon, { HitResult, PokemonMove } from "../field/pokemon";
import { Type } from "./type";
import * as Utils from "../utils";
import { BattleStat, getBattleStatName } from "./battle-stat";
import { PokemonHealPhase, ShowAbilityPhase, StatChangePhase } from "../phases";
import { getPokemonMessage } from "../messages";
import { Weather, WeatherType } from "./weather";
import { BattlerTag } from "./battler-tags";
import { BattlerTagType } from "./enums/battler-tag-type";
import { StatusEffect, getStatusEffectDescriptor, getStatusEffectHealText } from "./status-effect";
import { Gender } from "./gender";
import Move, { AttackMove, MoveCategory, MoveFlags, MoveTarget, RecoilAttr, StatusMoveTypeImmunityAttr, FlinchAttr, allMoves } from "./move";
import { ArenaTagType } from "./enums/arena-tag-type";
import { Stat } from "./pokemon-stat";
import { PokemonHeldItemModifier } from "../modifier/modifier";
import { Moves } from "./enums/moves";
import { TerrainType } from "./terrain";
import { SpeciesFormChangeManualTrigger } from "./pokemon-forms";
import { Abilities } from "./enums/abilities";

export class Ability {
  public id: Abilities;
  public name: string;
  public description: string;
  public generation: integer;
  public isBypassFaint: boolean;
  public isIgnorable: boolean;
  public attrs: AbAttr[];
  public conditions: AbAttrCondition[];

  constructor(id: Abilities, name: string, description: string, generation: integer) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.generation = generation;
    this.attrs = [];
    this.conditions = [];
  }

  getAttrs(attrType: { new(...args: any[]): AbAttr }): AbAttr[] {
    return this.attrs.filter(a => a instanceof attrType);
  }

  attr<T extends new (...args: any[]) => AbAttr>(AttrType: T, ...args: ConstructorParameters<T>): Ability {
    const attr = new AttrType(...args);
    this.attrs.push(attr);

    return this;
  }

  conditionalAttr<T extends new (...args: any[]) => AbAttr>(condition: AbAttrCondition, AttrType: T, ...args: ConstructorParameters<T>): Ability {
    const attr = new AttrType(...args);
    attr.addCondition(condition);
    this.attrs.push(attr);
    
    return this;
  }
  
  hasAttr(attrType: { new(...args: any[]): AbAttr }): boolean {
    return !!this.getAttrs(attrType).length;
  }

  bypassFaint(): Ability {
    this.isBypassFaint = true;
    return this;
  }

  ignorable(): Ability {
    this.isIgnorable = true;
    return this;
  }

  condition(condition: AbAttrCondition): Ability {
    this.conditions.push(condition);

    return this;
  }
}

type AbAttrApplyFunc<TAttr extends AbAttr> = (attr: TAttr, passive: boolean) => boolean | Promise<boolean>;
type AbAttrCondition = (pokemon: Pokemon) => boolean;

type PokemonAttackCondition = (user: Pokemon, target: Pokemon, move: Move) => boolean;
type PokemonDefendCondition = (target: Pokemon, user: Pokemon, move: Move) => boolean;
type PokemonStatChangeCondition = (target: Pokemon, statsChanged: BattleStat[], levels: integer) => boolean;

export abstract class AbAttr {
  public showAbility: boolean;
  private extraCondition: AbAttrCondition;

  constructor(showAbility: boolean = true) {
    this.showAbility = showAbility;
  }
  
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return null;
  }

  getCondition(): AbAttrCondition {
    return this.extraCondition || null;
  }

  addCondition(condition: AbAttrCondition): AbAttr {
    this.extraCondition = condition;
    return this;
  }
}

export class BlockRecoilDamageAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;

    return true;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]) {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nprotected it from recoil!`);
  }
}

export class DoubleBattleChanceAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const doubleChance = (args[0] as Utils.IntegerHolder);
    doubleChance.value = Math.max(doubleChance.value / 2, 1);
    return true;
  }
}

export class PostBattleInitAbAttr extends AbAttr {
  applyPostBattleInit(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PostBattleInitFormChangeAbAttr extends PostBattleInitAbAttr {
  private formFunc: (p: Pokemon) => integer;

  constructor(formFunc: ((p: Pokemon) => integer)) {
    super(true);

    this.formFunc = formFunc;
  }

  applyPostBattleInit(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const formIndex = this.formFunc(pokemon);
    if (formIndex !== pokemon.formIndex)
      return pokemon.scene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger, false);

    return false;
  }
}

export class PostBattleInitStatChangeAbAttr extends PostBattleInitAbAttr {
  private stats: BattleStat[];
  private levels: integer;
  private selfTarget: boolean;

  constructor(stats: BattleStat | BattleStat[], levels: integer, selfTarget?: boolean) {
    super();

    this.stats = typeof(stats) === 'number'
      ? [ stats as BattleStat ]
      : stats as BattleStat[];
    this.levels = levels;
    this.selfTarget = !!selfTarget;
  }

  applyPostBattleInit(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const statChangePhases: StatChangePhase[] = [];

    if (this.selfTarget)
      statChangePhases.push(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, this.stats, this.levels));
    else {
      for (let opponent of pokemon.getOpponents())
        statChangePhases.push(new StatChangePhase(pokemon.scene, opponent.getBattlerIndex(), false, this.stats, this.levels));
    }

    for (let statChangePhase of statChangePhases) {
      if (!this.selfTarget && !statChangePhase.getPokemon().summonData)
        pokemon.scene.pushPhase(statChangePhase); // TODO: This causes the ability bar to be shown at the wrong time
      else
        pokemon.scene.unshiftPhase(statChangePhase);
    }
   
    return true;
  }
}

type PreDefendAbAttrCondition = (pokemon: Pokemon, attacker: Pokemon, move: PokemonMove) => boolean;

export class PreDefendAbAttr extends AbAttr {
  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PreDefendFormChangeAbAttr extends PreDefendAbAttr {
  private formFunc: (p: Pokemon) => integer;

  constructor(formFunc: ((p: Pokemon) => integer)) {
    super(true);

    this.formFunc = formFunc;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const formIndex = this.formFunc(pokemon);
    if (formIndex !== pokemon.formIndex) {
      pokemon.scene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger, false);
      return true;
    }

    return false;
  }
}
export class PreDefendFullHpEndureAbAttr extends PreDefendAbAttr {
  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1 || (args[0] as Utils.NumberHolder).value < pokemon.hp)
      return false;

    return pokemon.addTag(BattlerTagType.STURDY, 1);
  }
}

export class BlockItemTheftAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;
    
    return true;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]) {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nprevents item theft!`);
  }
}

export class StabBoostAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if ((args[0] as Utils.NumberHolder).value > 1) {
      (args[0] as Utils.NumberHolder).value += 0.5;
      return true;
    }
    
    return false;
  }
}

export class ReceivedMoveDamageMultiplierAbAttr extends PreDefendAbAttr {
  protected condition: PokemonDefendCondition;
  private powerMultiplier: number;

  constructor(condition: PokemonDefendCondition, powerMultiplier: number) {
    super();

    this.condition = condition;
    this.powerMultiplier = powerMultiplier;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.condition(pokemon, attacker, move.getMove())) {
      (args[0] as Utils.NumberHolder).value *= this.powerMultiplier;
      return true;
    }

    return false;
  }
}

export class ReceivedTypeDamageMultiplierAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor(moveType: Type, powerMultiplier: number) {
    super((user, target, move) => move.type === moveType, powerMultiplier);
  }
}

export class PreDefendMovePowerToOneAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor(condition: PokemonDefendCondition) {
    super(condition, 1);
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.condition(pokemon, attacker, move.getMove())) {
      (args[0] as Utils.NumberHolder).value = 1;
      return true;
    }

    return false;
  }
}

export class TypeImmunityAbAttr extends PreDefendAbAttr {
  private immuneType: Type;
  private condition: AbAttrCondition;

  constructor(immuneType: Type, condition?: AbAttrCondition) {
    super();

    this.immuneType = immuneType;
    this.condition = condition;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if ((move.getMove() instanceof AttackMove || move.getMove().getAttrs(StatusMoveTypeImmunityAttr).find(attr => (attr as StatusMoveTypeImmunityAttr).immuneType === this.immuneType)) && move.getMove().type === this.immuneType) {
      (args[0] as Utils.NumberHolder).value = 0;
      return true;
    }

    return false;
  }

  getCondition(): AbAttrCondition {
    return this.condition;
  }
}

export class TypeImmunityHealAbAttr extends TypeImmunityAbAttr {
  constructor(immuneType: Type) {
    super(immuneType);
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, passive, attacker, move, cancelled, args);

    if (ret) {
      if (pokemon.getHpRatio() < 1) {
        const simulated = args.length > 1 && args[1];
        if (!simulated) {
          const abilityName = (!passive ? pokemon.getAbility() : pokemon.getPassiveAbility()).name;
          pokemon.scene.unshiftPhase(new PokemonHealPhase(pokemon.scene, pokemon.getBattlerIndex(),
            Math.max(Math.floor(pokemon.getMaxHp() / 4), 1), getPokemonMessage(pokemon, `'s ${abilityName}\nrestored its HP a little!`), true));
        }
      }
      return true;
    }
    
    return false;
  }
}

class TypeImmunityStatChangeAbAttr extends TypeImmunityAbAttr {
  private stat: BattleStat;
  private levels: integer;

  constructor(immuneType: Type, stat: BattleStat, levels: integer, condition?: AbAttrCondition) {
    super(immuneType, condition);

    this.stat = stat;
    this.levels = levels;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, passive, attacker, move, cancelled, args);

    if (ret) {
      cancelled.value = true;
      const simulated = args.length > 1 && args[1];
      if (!simulated)
        pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, [ this.stat ], this.levels));
    }
    
    return ret;
  }
}

class TypeImmunityAddBattlerTagAbAttr extends TypeImmunityAbAttr {
  private tagType: BattlerTagType;
  private turnCount: integer;

  constructor(immuneType: Type, tagType: BattlerTagType, turnCount: integer, condition?: AbAttrCondition) {
    super(immuneType, condition);

    this.tagType = tagType;
    this.turnCount = turnCount;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, passive, attacker, move, cancelled, args);

    if (ret) {
      cancelled.value = true;
      const simulated = args.length > 1 && args[1];
      if (!simulated)
        pokemon.addTag(this.tagType, this.turnCount, undefined, pokemon.id);
    }
    
    return ret;
  }
}

export class NonSuperEffectiveImmunityAbAttr extends TypeImmunityAbAttr {
  constructor(condition?: AbAttrCondition) {
    super(null, condition);
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (move.getMove() instanceof AttackMove && pokemon.getAttackTypeEffectiveness(move.getMove().type) < 2) {
      cancelled.value = true;
      (args[0] as Utils.NumberHolder).value = 0;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, ` avoided damage\nwith ${abilityName}!`);
  }
}

export class PostDefendAbAttr extends AbAttr {
  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PostDefendDisguiseAbAttr extends PostDefendAbAttr {

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (pokemon.formIndex == 0 && pokemon.battleData.hitCount != 0 && (move.getMove().category == MoveCategory.SPECIAL || move.getMove().category == MoveCategory.PHYSICAL)) {
      
      const recoilDamage = Math.ceil((pokemon.getMaxHp() / 8) - attacker.turnData.damageDealt);
      if (!recoilDamage)
        return false;
      pokemon.damageAndUpdate(recoilDamage, HitResult.OTHER);
      pokemon.scene.queueMessage(getPokemonMessage(pokemon, '\'s disguise was busted!'));
      return true;
    }

    return false;
  }
}

export class PostDefendFormChangeAbAttr extends PostDefendAbAttr {
  private formFunc: (p: Pokemon) => integer;

  constructor(formFunc: ((p: Pokemon) => integer)) {
    super(true);

    this.formFunc = formFunc;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    const formIndex = this.formFunc(pokemon);
    if (formIndex !== pokemon.formIndex) {
      pokemon.scene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger, false);
      return true;
    }

    return false;
  }
}

export class FieldPriorityMoveImmunityAbAttr extends PreDefendAbAttr {
  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
      const attackPriority = new Utils.IntegerHolder(move.getMove().priority);
      applyAbAttrs(IncrementMovePriorityAbAttr, attacker, null, move.getMove(), attackPriority);
  
      if(attackPriority.value > 0 && !move.getMove().isMultiTarget()) {
        cancelled.value = true;
        return true;
      }
    
    return false;
  }
}

export class PostStatChangeAbAttr extends AbAttr {
  applyPostStatChange(pokemon: Pokemon, statsChanged: BattleStat[], levelChanged: integer, selfTarget: boolean, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class MoveImmunityAbAttr extends PreDefendAbAttr {
  private immuneCondition: PreDefendAbAttrCondition;

  constructor(immuneCondition: PreDefendAbAttrCondition) {
    super(true);

    this.immuneCondition = immuneCondition;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.immuneCondition(pokemon, attacker, move)) {
      cancelled.value = true;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return `It doesn\'t affect ${pokemon.name}!`;
  }
}

export class MoveImmunityStatChangeAbAttr extends MoveImmunityAbAttr {
  private stat: BattleStat;
  private levels: integer;

  constructor(immuneCondition: PreDefendAbAttrCondition, stat: BattleStat, levels: integer) {
    super(immuneCondition);
    this.stat = stat;
    this.levels = levels;
  }

  applyPreDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ret = super.applyPreDefend(pokemon, passive, attacker, move, cancelled, args)
    if (ret) {
      pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, [ this.stat ], this.levels));
    }

    return ret;
  }
}

export class PostDefendStatChangeAbAttr extends PostDefendAbAttr {
  private condition: PokemonDefendCondition;
  private stat: BattleStat;
  private levels: integer;
  private selfTarget: boolean;

  constructor(condition: PokemonDefendCondition, stat: BattleStat, levels: integer, selfTarget: boolean = true) {
    super(true);

    this.condition = condition;
    this.stat = stat;
    this.levels = levels;
    this.selfTarget = selfTarget;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (this.condition(pokemon, attacker, move.getMove())) {
      pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, (this.selfTarget ? pokemon : attacker).getBattlerIndex(), true, [ this.stat ], this.levels));
      return true;
    }

    return false;
  }
}

export class PostDefendApplyBattlerTagAbAttr extends PostDefendAbAttr {
  private condition: PokemonDefendCondition;
  private tagType: BattlerTagType;
  constructor(condition: PokemonDefendCondition, tagType: BattlerTagType) {
    super(true);

    this.condition = condition;
    this.tagType = tagType;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (this.condition(pokemon, attacker, move.getMove())) {
      pokemon.addTag(this.tagType, undefined, undefined, pokemon.id);
      return true;
    }
    return false;
  }
}

export class PostDefendTypeChangeAbAttr extends PostDefendAbAttr {
  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (hitResult < HitResult.NO_EFFECT) {
      const type = move.getMove().type;
      const pokemonTypes = pokemon.getTypes(true);
      if (pokemonTypes.length !== 1 || pokemonTypes[0] !== type) {
        pokemon.summonData.types = [ type ];
        return true;
      }
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nmade it the ${Utils.toReadableString(Type[pokemon.getTypes(true)[0]])} type!`);
  }
}

export class PostDefendTerrainChangeAbAttr extends PostDefendAbAttr {
  private terrainType: TerrainType;

  constructor(terrainType: TerrainType) {
    super();

    this.terrainType = terrainType;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (hitResult < HitResult.NO_EFFECT)
      return pokemon.scene.arena.trySetTerrain(this.terrainType, true);

    return false;
  }
}

export class PostDefendContactApplyStatusEffectAbAttr extends PostDefendAbAttr {
  private chance: integer;
  private effects: StatusEffect[];

  constructor(chance: integer, ...effects: StatusEffect[]) {
    super();

    this.chance = chance;
    this.effects = effects;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon) && !attacker.status && (this.chance === -1 || pokemon.randSeedInt(100) < this.chance)) {
      const effect = this.effects.length === 1 ? this.effects[0] : this.effects[pokemon.randSeedInt(this.effects.length)];
      return attacker.trySetStatus(effect, true);
    }

    return false;
  }
}

export class PostDefendContactApplyTagChanceAbAttr extends PostDefendAbAttr {
  private chance: integer;
  private tagType: BattlerTagType;
  private turnCount: integer;

  constructor(chance: integer, tagType: BattlerTagType, turnCount?: integer) {
    super();

    this.tagType = tagType;
    this.chance = chance;
    this.turnCount = turnCount;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon) && pokemon.randSeedInt(100) < this.chance)
      return attacker.addTag(this.tagType, this.turnCount, move.moveId, attacker.id);

    return false;
  }
}

export class PostDefendCritStatChangeAbAttr extends PostDefendAbAttr {
  private stat: BattleStat;
  private levels: integer;

  constructor(stat: BattleStat, levels: integer) {
    super();

    this.stat = stat;
    this.levels = levels;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, [ this.stat ], this.levels));
    
    return true;
  }

  getCondition(): AbAttrCondition {
    return (pokemon: Pokemon) => pokemon.turnData.attacksReceived.length && pokemon.turnData.attacksReceived[pokemon.turnData.attacksReceived.length - 1].critical;
  }
}

export class PostDefendContactDamageAbAttr extends PostDefendAbAttr {
  private damageRatio: integer;

  constructor(damageRatio: integer) {
    super();

    this.damageRatio = damageRatio;
  }
  
  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon)) {
      attacker.damageAndUpdate(Math.ceil(attacker.getMaxHp() * (1 / this.damageRatio)), HitResult.OTHER);
      return true;
    }
    
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nhurt its attacker!`);
  }
}

export class PostDefendWeatherChangeAbAttr extends PostDefendAbAttr {
  private weatherType: WeatherType;

  constructor(weatherType: WeatherType) {
    super();

    this.weatherType = weatherType;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (!pokemon.scene.arena.weather?.isImmutable())
      return pokemon.scene.arena.trySetWeather(this.weatherType, true);

    return false;
  }
}

export class PostDefendAbilitySwapAbAttr extends PostDefendAbAttr {
  constructor() {
    super();
  }
  
  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon) && !attacker.getAbility().hasAttr(UnswappableAbilityAbAttr)) {
      const tempAbilityId = attacker.getAbility().id;
      attacker.summonData.ability = pokemon.getAbility().id;
      pokemon.summonData.ability = tempAbilityId;
      return true;
    }
    
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, ` swapped\nabilities with its target!`);
  }
}

export class PostDefendAbilityGiveAbAttr extends PostDefendAbAttr {
  constructor() {
    super();
  }
  
  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon) && !attacker.getAbility().hasAttr(UnsuppressableAbilityAbAttr) && !attacker.getAbility().hasAttr(PostDefendAbilityGiveAbAttr)) {
      attacker.summonData.ability = pokemon.getAbility().id;

      return true;
    }
    
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, ` gave its target\n${abilityName}!`);
  }
}

export class PostStatChangeStatChangeAbAttr extends PostStatChangeAbAttr {
  private condition: PokemonStatChangeCondition;
  private statsToChange: BattleStat[];
  private levels: integer;

  constructor(condition: PokemonStatChangeCondition, statsToChange: BattleStat[], levels: integer) {
    super(true);

    this.condition = condition;
    this.statsToChange = statsToChange;
    this.levels = levels;
  }

  applyPostStatChange(pokemon: Pokemon, statsChanged: BattleStat[], levelsChanged: integer, selfTarget: boolean, args: any[]): boolean {
    if (this.condition(pokemon, statsChanged, levelsChanged) && !selfTarget) {
      pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, (pokemon).getBattlerIndex(), true, this.statsToChange, this.levels));
      return true;
    }

    return false;
  }
}

export class PreAttackAbAttr extends AbAttr {
  applyPreAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class VariableMovePowerAbAttr extends PreAttackAbAttr {
  applyPreAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    //const power = args[0] as Utils.NumberHolder;
    return false;
  }
}

export class VariableMoveTypeAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    //const power = args[0] as Utils.IntegerHolder;
    return false; 
  }
}

export class MoveTypeChangePowerMultiplierAbAttr extends VariableMoveTypeAbAttr {
  private matchType: Type;
  private newType: Type;
  private powerMultiplier: number;

  constructor(matchType: Type, newType: Type, powerMultiplier: number){
    super(true);
    this.matchType = matchType;
    this.newType = newType;
    this.powerMultiplier = powerMultiplier;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const type = (args[0] as Utils.IntegerHolder);
    if (type.value == this.matchType) {
      type.value = this.newType;
      (args[1] as Utils.NumberHolder).value *= this.powerMultiplier;
      return true;
    }
    
    return false;
  }
}

export class MoveTypeChangeAttr extends PreAttackAbAttr {
  private newType: Type;
  private powerMultiplier: number;
  private condition: PokemonAttackCondition;

  constructor(newType: Type, powerMultiplier: number, condition: PokemonAttackCondition){
    super(true);
    this.newType = newType;
    this.powerMultiplier = powerMultiplier;
    this.condition = condition;
  }

  applyPreAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    if (this.condition(pokemon, defender, move.getMove())) {
      const type = (args[0] as Utils.IntegerHolder);
      type.value = this.newType;
      (args[1] as Utils.NumberHolder).value *= this.powerMultiplier;
      return true;
    }

    return false;
  }
}

export class MovePowerBoostAbAttr extends VariableMovePowerAbAttr {
  private condition: PokemonAttackCondition;
  private powerMultiplier: number;

  constructor(condition: PokemonAttackCondition, powerMultiplier: number) {
    super(true);
    this.condition = condition;
    this.powerMultiplier = powerMultiplier;
  }

  applyPreAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    if (this.condition(pokemon, defender, move.getMove())) {
      (args[0] as Utils.NumberHolder).value *= this.powerMultiplier;

      return true;
    }

    return false;
  }
}

export class MoveTypePowerBoostAbAttr extends MovePowerBoostAbAttr {
  constructor(boostedType: Type, powerMultiplier?: number) {
    super((pokemon, defender, move) => move.type === boostedType, powerMultiplier || 1.5);
  }
}

export class LowHpMoveTypePowerBoostAbAttr extends MoveTypePowerBoostAbAttr {
  constructor(boostedType: Type) {
    super(boostedType);
  }

  getCondition(): AbAttrCondition {
    return (pokemon) => pokemon.getHpRatio() <= 0.33;
  }
}

export class FieldVariableMovePowerAbAttr extends AbAttr {
  applyPreAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    //const power = args[0] as Utils.NumberHolder;
    return false; 
  }
}

export class FieldMovePowerBoostAbAttr extends FieldVariableMovePowerAbAttr {
  private condition: PokemonAttackCondition;
  private powerMultiplier: number;

  constructor(condition: PokemonAttackCondition, powerMultiplier: number) {
    super(false);
    this.condition = condition;
    this.powerMultiplier = powerMultiplier;
  }

  applyPreAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, args: any[]): boolean {
    if (this.condition(pokemon, defender, move.getMove())) {
      (args[0] as Utils.NumberHolder).value *= this.powerMultiplier;

      return true;
    }

    return false;
  }
}

export class FieldMoveTypePowerBoostAbAttr extends FieldMovePowerBoostAbAttr {
  constructor(boostedType: Type, powerMultiplier?: number) {
    super((pokemon, defender, move) => move.type === boostedType, powerMultiplier || 1.5);
  }
}

export class BattleStatMultiplierAbAttr extends AbAttr {
  private battleStat: BattleStat;
  private multiplier: number;

  constructor(battleStat: BattleStat, multiplier: number) {
    super(false);

    this.battleStat = battleStat;
    this.multiplier = multiplier;
  }

  applyBattleStat(pokemon: Pokemon, passive: boolean, battleStat: BattleStat, statValue: Utils.NumberHolder, args: any[]): boolean | Promise<boolean> {
    if (battleStat === this.battleStat) {
      statValue.value *= this.multiplier;
      return true;
    }

    return false;
  }
}

export class PostAttackAbAttr extends AbAttr {
  applyPostAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PostAttackStealHeldItemAbAttr extends PostAttackAbAttr {
  private condition: PokemonAttackCondition;

  constructor(condition?: PokemonAttackCondition) {
    super();

    this.condition = condition;
  }

  applyPostAttack(pokemon: Pokemon, passive: boolean, defender: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      if (hitResult < HitResult.NO_EFFECT && (!this.condition || this.condition(pokemon, defender, move.getMove()))) {
        const heldItems = this.getTargetHeldItems(defender).filter(i => i.getTransferrable(false));
        if (heldItems.length) {
          const stolenItem = heldItems[pokemon.randSeedInt(heldItems.length)];
          pokemon.scene.tryTransferHeldItemModifier(stolenItem, pokemon, false, false).then(success => {
            if (success)
              pokemon.scene.queueMessage(getPokemonMessage(pokemon, ` stole\n${defender.name}'s ${stolenItem.type.name}!`));
            resolve(success);
          });
          return;
        }
      }
      resolve(false);
    });
  }

  getTargetHeldItems(target: Pokemon): PokemonHeldItemModifier[] {
    return target.scene.findModifiers(m => m instanceof PokemonHeldItemModifier
      && (m as PokemonHeldItemModifier).pokemonId === target.id, target.isPlayer()) as PokemonHeldItemModifier[];
  }
}

export class PostAttackApplyStatusEffectAbAttr extends PostAttackAbAttr {
  private contactRequired: boolean;
  private chance: integer;
  private effects: StatusEffect[];

  constructor(contactRequired: boolean, chance: integer, ...effects: StatusEffect[]) {
    super();

    this.contactRequired = contactRequired;
    this.chance = chance;
    this.effects = effects;
  }

  applyPostAttack(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (pokemon != attacker && (!this.contactRequired || move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon)) && pokemon.randSeedInt(100) < this.chance && !pokemon.status) {
      const effect = this.effects.length === 1 ? this.effects[0] : this.effects[pokemon.randSeedInt(this.effects.length)];
      return attacker.trySetStatus(effect, true);
    }

    return false;
  }
}

export class PostAttackContactApplyStatusEffectAbAttr extends PostAttackApplyStatusEffectAbAttr {
  constructor(chance: integer, ...effects: StatusEffect[]) {
    super(true, chance, ...effects);
  }
}

export class PostAttackApplyBattlerTagAbAttr extends PostAttackAbAttr {
  private contactRequired: boolean;
  private chance: (user: Pokemon, target: Pokemon, move: PokemonMove) => integer;
  private effects: BattlerTagType[];

  
  constructor(contactRequired: boolean, chance: (user: Pokemon, target: Pokemon, move: PokemonMove) =>  integer, ...effects: BattlerTagType[]) {
    super();

    this.contactRequired = contactRequired;
    this.chance = chance;
    this.effects = effects;
  }

  applyPostAttack(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (pokemon != attacker && (!this.contactRequired || move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon)) && pokemon.randSeedInt(100) < this.chance(attacker, pokemon, move) && !pokemon.status) {
      const effect = this.effects.length === 1 ? this.effects[0] : this.effects[pokemon.randSeedInt(this.effects.length)];


      return attacker.addTag(effect);
    }

    return false;
  }
}

export class PostDefendStealHeldItemAbAttr extends PostDefendAbAttr {
  private condition: PokemonDefendCondition;

  constructor(condition?: PokemonDefendCondition) {
    super();

    this.condition = condition;
  }

  applyPostDefend(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      if (hitResult < HitResult.NO_EFFECT && (!this.condition || this.condition(pokemon, attacker, move.getMove()))) {
        const heldItems = this.getTargetHeldItems(attacker).filter(i => i.getTransferrable(false));
        if (heldItems.length) {
          const stolenItem = heldItems[pokemon.randSeedInt(heldItems.length)];
          pokemon.scene.tryTransferHeldItemModifier(stolenItem, pokemon, false, false).then(success => {
            if (success)
              pokemon.scene.queueMessage(getPokemonMessage(pokemon, ` stole\n${attacker.name}'s ${stolenItem.type.name}!`));
            resolve(success);
          });
          return;
        }
      }
      resolve(false);
    });
  }

  getTargetHeldItems(target: Pokemon): PokemonHeldItemModifier[] {
    return target.scene.findModifiers(m => m instanceof PokemonHeldItemModifier
      && (m as PokemonHeldItemModifier).pokemonId === target.id, target.isPlayer()) as PokemonHeldItemModifier[];
  }
}

export class PostVictoryAbAttr extends AbAttr {
  applyPostVictory(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

class PostVictoryStatChangeAbAttr extends PostVictoryAbAttr {
  private stat: BattleStat | ((p: Pokemon) => BattleStat);
  private levels: integer;

  constructor(stat: BattleStat | ((p: Pokemon) => BattleStat), levels: integer) {
    super();

    this.stat = stat;
    this.levels = levels;
  }

  applyPostVictory(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    const stat = typeof this.stat === 'function'
      ? this.stat(pokemon)
      : this.stat;
    pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, [ stat ], this.levels));
    
    return true;
  }
}

export class PostKnockOutAbAttr extends AbAttr {
  applyPostKnockOut(pokemon: Pokemon, passive: boolean, knockedOut: Pokemon, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PostKnockOutStatChangeAbAttr extends PostKnockOutAbAttr {
  private stat: BattleStat | ((p: Pokemon) => BattleStat);
  private levels: integer;

  constructor(stat: BattleStat | ((p: Pokemon) => BattleStat), levels: integer) {
    super();

    this.stat = stat;
    this.levels = levels;
  }

  applyPostKnockOut(pokemon: Pokemon, passive: boolean, knockedOut: Pokemon, args: any[]): boolean | Promise<boolean> {
    const stat = typeof this.stat === 'function'
      ? this.stat(pokemon)
      : this.stat;
    pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, [ stat ], this.levels));
    
    return true;
  }
}

export class CopyFaintedAllyAbilityAbAttr extends PostKnockOutAbAttr {
  constructor() {
    super();
  }

  applyPostKnockOut(pokemon: Pokemon, passive: boolean, knockedOut: Pokemon, args: any[]): boolean | Promise<boolean> {
    if (pokemon.isPlayer() === knockedOut.isPlayer() && !knockedOut.getAbility().hasAttr(UncopiableAbilityAbAttr)) {
      pokemon.summonData.ability = knockedOut.getAbility().id;
      pokemon.scene.queueMessage(getPokemonMessage(knockedOut, `'s ${allAbilities[knockedOut.getAbility().id].name} was taken over!`));
      return true;
    }
    
    return false;
  }
}

export class IgnoreOpponentStatChangesAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]) {
    (args[0] as Utils.IntegerHolder).value = 0;

    return true;
  }
}

export class PostSummonAbAttr extends AbAttr {
  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PostSummonMessageAbAttr extends PostSummonAbAttr {
  private messageFunc: (pokemon: Pokemon) => string;

  constructor(messageFunc: (pokemon: Pokemon) => string) {
    super(true);

    this.messageFunc = messageFunc;
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    pokemon.scene.queueMessage(this.messageFunc(pokemon));

    return true;
  }
}

export class PostSummonAddBattlerTagAbAttr extends PostSummonAbAttr {
  private tagType: BattlerTagType;
  private turnCount: integer;

  constructor(tagType: BattlerTagType, turnCount: integer, showAbility?: boolean) {
    super(showAbility);

    this.tagType = tagType;
    this.turnCount = turnCount;
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    return pokemon.addTag(this.tagType, this.turnCount);
  }
}

export class PostSummonStatChangeAbAttr extends PostSummonAbAttr {
  private stats: BattleStat[];
  private levels: integer;
  private selfTarget: boolean;

  constructor(stats: BattleStat | BattleStat[], levels: integer, selfTarget?: boolean) {
    super();

    this.stats = typeof(stats) === 'number'
      ? [ stats as BattleStat ]
      : stats as BattleStat[];
    this.levels = levels;
    this.selfTarget = !!selfTarget;
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const statChangePhases: StatChangePhase[] = [];

    if (this.selfTarget)
      statChangePhases.push(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, this.stats, this.levels));
    else {
      for (let opponent of pokemon.getOpponents())
        statChangePhases.push(new StatChangePhase(pokemon.scene, opponent.getBattlerIndex(), false, this.stats, this.levels));
    }

    for (let statChangePhase of statChangePhases) {
      if (!this.selfTarget && !statChangePhase.getPokemon().summonData)
        pokemon.scene.pushPhase(statChangePhase); // TODO: This causes the ability bar to be shown at the wrong time
      else
        pokemon.scene.unshiftPhase(statChangePhase);
    }
   
    return true;
  }
}

export class DownloadAbAttr extends PostSummonAbAttr {
  private enemyDef: integer;
  private enemySpDef: integer;
  private stats: BattleStat[];

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    this.enemyDef = 0;
    this.enemySpDef = 0;
	
    for (let opponent of pokemon.getOpponents()) {
      this.enemyDef += opponent.stats[BattleStat.DEF];
      this.enemySpDef += opponent.stats[BattleStat.SPDEF];
    }
	
    if (this.enemyDef < this.enemySpDef)
      this.stats = [BattleStat.ATK];
    else
      this.stats = [BattleStat.SPATK];

    if (this.enemyDef > 0 && this.enemySpDef > 0) { // only activate if there's actually an enemy to download from
      pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), false, this.stats, 1));
      return true;
    }
	
    return false;
  }
}

export class PostSummonWeatherChangeAbAttr extends PostSummonAbAttr {
  private weatherType: WeatherType;

  constructor(weatherType: WeatherType) {
    super();

    this.weatherType = weatherType;
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    if (!pokemon.scene.arena.weather?.isImmutable())
      return pokemon.scene.arena.trySetWeather(this.weatherType, true);

    return false;
  }
}

export class PostSummonTerrainChangeAbAttr extends PostSummonAbAttr {
  private terrainType: TerrainType;

  constructor(terrainType: TerrainType) {
    super();

    this.terrainType = terrainType;
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    return pokemon.scene.arena.trySetTerrain(this.terrainType, true);
  }
}

export class PostSummonFormChangeAbAttr extends PostSummonAbAttr {
  private formFunc: (p: Pokemon) => integer;

  constructor(formFunc: ((p: Pokemon) => integer)) {
    super(true);

    this.formFunc = formFunc;
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const formIndex = this.formFunc(pokemon);
    if (formIndex !== pokemon.formIndex)
      return pokemon.scene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger, false);

    return false;
  }
}

export class TraceAbAttr extends PostSummonAbAttr {
  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const targets = pokemon.getOpponents();
    if (!targets.length)
      return false;
    let target: Pokemon;
    if (targets.length > 1)
      pokemon.scene.executeWithSeedOffset(() => target = Utils.randSeedItem(targets), pokemon.scene.currentBattle.waveIndex);
    else
      target = targets[0];

    // Wonder Guard is normally uncopiable so has the attribute, but trace specifically can copy it
    if (target.getAbility().hasAttr(UncopiableAbilityAbAttr) && target.getAbility().id !== Abilities.WONDER_GUARD)
      return false;

    pokemon.summonData.ability = target.getAbility().id;

    pokemon.scene.queueMessage(getPokemonMessage(pokemon, ` traced ${target.name}'s\n${allAbilities[target.getAbility().id].name}!`));

    return true;
  }
}

export class PostSummonTransformAbAttr extends PostSummonAbAttr {
  constructor() {
    super(true);
  }

  applyPostSummon(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const targets = pokemon.getOpponents();
    let target: Pokemon;
    if (targets.length > 1)
      pokemon.scene.executeWithSeedOffset(() => target = Utils.randSeedItem(targets), pokemon.scene.currentBattle.waveIndex);
    else
      target = targets[0];

    pokemon.summonData.speciesForm = target.getSpeciesForm();
    pokemon.summonData.fusionSpeciesForm = target.getFusionSpeciesForm();
    pokemon.summonData.ability = target.getAbility().id;
    pokemon.summonData.gender = target.getGender();
    pokemon.summonData.fusionGender = target.getFusionGender();
    pokemon.summonData.stats = [ pokemon.stats[Stat.HP] ].concat(target.stats.slice(1));
    pokemon.summonData.battleStats = target.summonData.battleStats.slice(0);
    pokemon.summonData.moveset = target.getMoveset().map(m => new PokemonMove(m.moveId, m.ppUsed, m.ppUp));
    pokemon.summonData.types = target.getTypes();
    
    pokemon.scene.playSound('PRSFX- Transform');

    pokemon.loadAssets(false).then(() => pokemon.playAnim());

    pokemon.scene.queueMessage(getPokemonMessage(pokemon, ` transformed\ninto ${target.name}!`));

    return true;
  }
}

export class PreSwitchOutAbAttr extends AbAttr {
  constructor() {
    super(true);
  }

  applyPreSwitchOut(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PreSwitchOutResetStatusAbAttr extends PreSwitchOutAbAttr {
  applyPreSwitchOut(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    if (pokemon.status) {
      pokemon.resetStatus();
      pokemon.updateInfo();
      return true;
    }

    return false;
  }
}

export class PreSwitchOutHealAbAttr extends PreSwitchOutAbAttr {
  applyPreSwitchOut(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    if (pokemon.getHpRatio() < 1 ) {
      const healAmount = Math.floor(pokemon.getMaxHp() * 0.33);
      pokemon.heal(healAmount);
      pokemon.updateInfo();
      return true;
    }

    return false;
  }
}

export class PreStatChangeAbAttr extends AbAttr {
  applyPreStatChange(pokemon: Pokemon, passive: boolean, stat: BattleStat, cancelled: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class ProtectStatAbAttr extends PreStatChangeAbAttr {
  private protectedStat: BattleStat;

  constructor(protectedStat?: BattleStat) {
    super();

    this.protectedStat = protectedStat;
  }

  applyPreStatChange(pokemon: Pokemon, passive: boolean, stat: BattleStat, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.protectedStat === undefined || stat === this.protectedStat) {
      cancelled.value = true;
      return true;
    }
    
    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nprevents lowering its ${this.protectedStat !== undefined ? getBattleStatName(this.protectedStat) : 'stats'}!`);
  }
}

export class PreSetStatusAbAttr extends AbAttr {
  applyPreSetStatus(pokemon: Pokemon, passive: boolean, effect: StatusEffect, cancelled: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class StatusEffectImmunityAbAttr extends PreSetStatusAbAttr {
  private immuneEffects: StatusEffect[];

  constructor(...immuneEffects: StatusEffect[]) {
    super();

    this.immuneEffects = immuneEffects;
  }

  applyPreSetStatus(pokemon: Pokemon, passive: boolean, effect: StatusEffect, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (!this.immuneEffects.length || this.immuneEffects.indexOf(effect) > -1) {
      cancelled.value = true;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nprevents ${this.immuneEffects.length ? getStatusEffectDescriptor(args[0] as StatusEffect) : 'status problems'}!`);
  }
}

export class PreApplyBattlerTagAbAttr extends AbAttr {
  applyPreApplyBattlerTag(pokemon: Pokemon, passive: boolean, tag: BattlerTag, cancelled: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class BattlerTagImmunityAbAttr extends PreApplyBattlerTagAbAttr {
  private immuneTagType: BattlerTagType;

  constructor(immuneTagType: BattlerTagType) {
    super();

    this.immuneTagType = immuneTagType;
  }

  applyPreApplyBattlerTag(pokemon: Pokemon, passive: boolean, tag: BattlerTag, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (tag.tagType === this.immuneTagType) {
      cancelled.value = true;
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${abilityName}\nprevents ${(args[0] as BattlerTag).getDescriptor()}!`);
  }
}

export class BlockCritAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.BooleanHolder).value = true;
    return true;
  }
}

export class BonusCritAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.BooleanHolder).value = true;
    return true;
  }
}

export class BlockNonDirectDamageAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;
    return true;
  }
}

export class BlockOneHitKOAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;
    return true;
  }
}

export class IncrementMovePriorityAbAttr extends AbAttr {
  private moveIncrementFunc: (pokemon: Pokemon, move: Move) => boolean;
  private increaseAmount: integer;

  constructor(moveIncrementFunc: (pokemon: Pokemon, move: Move) => boolean, increaseAmount = 1) {
    super(true);

    this.moveIncrementFunc = moveIncrementFunc;
    this.increaseAmount = increaseAmount;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (!this.moveIncrementFunc(pokemon, args[0] as Move))
      return false;
      
    (args[1] as Utils.IntegerHolder).value += this.increaseAmount;
    return true;
  }
}

export class IgnoreContactAbAttr extends AbAttr { }

export class PreWeatherEffectAbAttr extends AbAttr {
  applyPreWeatherEffect(pokemon: Pokemon, passive: boolean, weather: Weather, cancelled: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PreWeatherDamageAbAttr extends PreWeatherEffectAbAttr { }

export class BlockWeatherDamageAttr extends PreWeatherDamageAbAttr {
  private weatherTypes: WeatherType[];

  constructor(...weatherTypes: WeatherType[]) {
    super();

    this.weatherTypes = weatherTypes;
  }

  applyPreWeatherEffect(pokemon: Pokemon, passive: boolean, weather: Weather, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (!this.weatherTypes.length || this.weatherTypes.indexOf(weather?.weatherType) > -1)
      cancelled.value = true;

    return true;
  }
}

export class SuppressWeatherEffectAbAttr extends PreWeatherEffectAbAttr {
  public affectsImmutable: boolean;

  constructor(affectsImmutable?: boolean) {
    super();

    this.affectsImmutable = affectsImmutable;
  }

  applyPreWeatherEffect(pokemon: Pokemon, passive: boolean, weather: Weather, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.affectsImmutable || weather.isImmutable()) {
      cancelled.value = true;
      return true;
    }

    return false;
  }
}

function getWeatherCondition(...weatherTypes: WeatherType[]): AbAttrCondition {
  return (pokemon: Pokemon) => {
    if (pokemon.scene.arena.weather?.isEffectSuppressed(pokemon.scene))
      return false;
    const weatherType = pokemon.scene.arena.weather?.weatherType;
    return weatherType && weatherTypes.indexOf(weatherType) > -1;
  };
}

export class PostWeatherChangeAbAttr extends AbAttr {
  applyPostWeatherChange(pokemon: Pokemon, passive: boolean, weather: WeatherType, args: any[]): boolean {
    return false;
  }
}

export class PostWeatherChangeAddBattlerTagAttr extends PostWeatherChangeAbAttr {
  private tagType: BattlerTagType;
  private turnCount: integer;
  private weatherTypes: WeatherType[];

  constructor(tagType: BattlerTagType, turnCount: integer, ...weatherTypes: WeatherType[]) {
    super();

    this.tagType = tagType;
    this.turnCount = turnCount;
    this.weatherTypes = weatherTypes;
  }

  applyPostWeatherChange(pokemon: Pokemon, passive: boolean, weather: WeatherType, args: any[]): boolean {
    console.log(this.weatherTypes.find(w => weather === w), WeatherType[weather]);
    if (!this.weatherTypes.find(w => weather === w))
      return false;

    return pokemon.addTag(this.tagType, this.turnCount);
  }
}

export class PostWeatherLapseAbAttr extends AbAttr {
  protected weatherTypes: WeatherType[];

  constructor(...weatherTypes: WeatherType[]) {
    super();

    this.weatherTypes = weatherTypes;
  }

  applyPostWeatherLapse(pokemon: Pokemon, passive: boolean, weather: Weather, args: any[]): boolean | Promise<boolean> {
    return false;
  }

  getCondition(): AbAttrCondition {
    return getWeatherCondition(...this.weatherTypes);
  }
}

export class PostWeatherLapseHealAbAttr extends PostWeatherLapseAbAttr {
  private healFactor: integer;

  constructor(healFactor: integer, ...weatherTypes: WeatherType[]) {
    super(...weatherTypes);
    
    this.healFactor = healFactor;
  }

  applyPostWeatherLapse(pokemon: Pokemon, passive: boolean, weather: Weather, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      const abilityName = (!passive ? pokemon.getAbility() : pokemon.getPassiveAbility()).name;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.getBattlerIndex(),
        Math.max(Math.floor(pokemon.getMaxHp() / (16 / this.healFactor)), 1), getPokemonMessage(pokemon, `'s ${abilityName}\nrestored its HP a little!`), true));
      return true;
    }

    return false;
  }
}

export class PostWeatherLapseDamageAbAttr extends PostWeatherLapseAbAttr {
  private damageFactor: integer;

  constructor(damageFactor: integer, ...weatherTypes: WeatherType[]) {
    super(...weatherTypes);
    
    this.damageFactor = damageFactor;
  }

  applyPostWeatherLapse(pokemon: Pokemon, passive: boolean, weather: Weather, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      const abilityName = (!passive ? pokemon.getAbility() : pokemon.getPassiveAbility()).name;
      scene.queueMessage(getPokemonMessage(pokemon, ` is hurt\nby its ${abilityName}!`));
      pokemon.damageAndUpdate(Math.ceil(pokemon.getMaxHp() / (16 / this.damageFactor)), HitResult.OTHER);
      return true;
    }

    return false;
  }
}

export class PostTerrainChangeAbAttr extends AbAttr {
  applyPostTerrainChange(pokemon: Pokemon, passive: boolean, terrain: TerrainType, args: any[]): boolean {
    return false;
  }
}

export class PostTerrainChangeAddBattlerTagAttr extends PostTerrainChangeAbAttr {
  private tagType: BattlerTagType;
  private turnCount: integer;
  private terrainTypes: TerrainType[];

  constructor(tagType: BattlerTagType, turnCount: integer, ...terrainTypes: TerrainType[]) {
    super();

    this.tagType = tagType;
    this.turnCount = turnCount;
    this.terrainTypes = terrainTypes;
  }

  applyPostTerrainChange(pokemon: Pokemon, passive: boolean, terrain: TerrainType, args: any[]): boolean {
    if (!this.terrainTypes.find(t => terrain === terrain))
      return false;

    return pokemon.addTag(this.tagType, this.turnCount);
  }
}

function getTerrainCondition(...terrainTypes: TerrainType[]): AbAttrCondition {
  return (pokemon: Pokemon) => {
    const terrainType = pokemon.scene.arena.terrain?.terrainType;
    return terrainType && terrainTypes.indexOf(terrainType) > -1;
  };
}

export class PostTurnAbAttr extends AbAttr {
  applyPostTurn(pokemon: Pokemon, passive: boolean, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class PostTurnResetStatusAbAttr extends PostTurnAbAttr {
  applyPostTurn(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    if (pokemon.status) {
	
      pokemon.scene.queueMessage(getPokemonMessage(pokemon, getStatusEffectHealText(pokemon.status?.effect)));
      pokemon.resetStatus();
      pokemon.updateInfo();
      return true;
    }
	
    return false;
  }
}

export class PostTurnStatChangeAbAttr extends PostTurnAbAttr {
  private stats: BattleStat[];
  private levels: integer;

  constructor(stats: BattleStat | BattleStat[], levels: integer) {
    super(true);

    this.stats = Array.isArray(stats)
      ? stats
      : [ stats ];
    this.levels = levels;
  }

  applyPostTurn(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, this.stats, this.levels));
    return true;
  }
}

export class PostTurnHealAbAttr extends PostTurnAbAttr {
  applyPostTurn(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    if (pokemon.getHpRatio() < 1) {
      const scene = pokemon.scene;
      const abilityName = (!passive ? pokemon.getAbility() : pokemon.getPassiveAbility()).name;
      scene.unshiftPhase(new PokemonHealPhase(scene, pokemon.getBattlerIndex(),
        Math.max(Math.floor(pokemon.getMaxHp() / 16), 1), getPokemonMessage(pokemon, `'s ${abilityName}\nrestored its HP a little!`), true));
      return true;
    }

    return false;
  }
}

export class PostTurnFormChangeAbAttr extends PostTurnAbAttr {
  private formFunc: (p: Pokemon) => integer;

  constructor(formFunc: ((p: Pokemon) => integer)) {
    super(true);

    this.formFunc = formFunc;
  }

  applyPostTurn(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const formIndex = this.formFunc(pokemon);
    if (formIndex !== pokemon.formIndex) {
      pokemon.scene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger, false);
      return true;
    }

    return false;
  }
}

export class PostBiomeChangeAbAttr extends AbAttr { }

export class PostBiomeChangeWeatherChangeAbAttr extends PostBiomeChangeAbAttr {
  private weatherType: WeatherType;

  constructor(weatherType: WeatherType) {
    super();

    this.weatherType = weatherType;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (!pokemon.scene.arena.weather?.isImmutable())
      return pokemon.scene.arena.trySetWeather(this.weatherType, true);

    return false;
  }
}

export class PostBiomeChangeTerrainChangeAbAttr extends PostBiomeChangeAbAttr {
  private terrainType: TerrainType;

  constructor(terrainType: TerrainType) {
    super();

    this.terrainType = terrainType;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    return pokemon.scene.arena.trySetTerrain(this.terrainType, true);
  }
}

export class StatChangeMultiplierAbAttr extends AbAttr {
  private multiplier: integer;

  constructor(multiplier: integer) {
    super(true);

    this.multiplier = multiplier;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.IntegerHolder).value *= this.multiplier;

    return true;
  }
}

export class BypassBurnDamageReductionAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;

    return true;
  }
}

export class DoubleBerryEffectAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.NumberHolder).value *= 2;

    return true;
  }
}

export class PreventBerryUseAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    cancelled.value = true;

    return true;
  }
}

export class RunSuccessAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.IntegerHolder).value = 256;

    return true;
  }
}

export class CheckTrappedAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
  
  applyCheckTrapped(pokemon: Pokemon, passive: boolean, trapped: Utils.BooleanHolder, args: any[]): boolean | Promise<boolean> {
    return false;
  }
}

export class ArenaTrapAbAttr extends CheckTrappedAbAttr {
  applyCheckTrapped(pokemon: Pokemon, passive: boolean, trapped: Utils.BooleanHolder, args: any[]): boolean {
    trapped.value = true;
    return true;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `\'s ${abilityName}\nprevents switching!`);
  }
}

export class MaxMultiHitAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.IntegerHolder).value = 0;

    return true;
  }
}

export class PostBattleAbAttr extends AbAttr {
  constructor() {
    super(true);
  }

  applyPostBattle(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    return false;
  }
}

export class PostBattleLootAbAttr extends PostBattleAbAttr {
  applyPostBattle(pokemon: Pokemon, passive: boolean, args: any[]): boolean {
    const postBattleLoot = pokemon.scene.currentBattle.postBattleLoot;
    if (postBattleLoot.length) {
      const randItem = Utils.randSeedItem(postBattleLoot);
      if (pokemon.scene.tryTransferHeldItemModifier(randItem, pokemon, false, true, true)) {
        postBattleLoot.splice(postBattleLoot.indexOf(randItem), 1);
        pokemon.scene.queueMessage(getPokemonMessage(pokemon, ` picked up\n${randItem.type.name}!`));
        return true;
      }
    }

    return false;
  }
}

export class PostFaintAbAttr extends AbAttr {
  applyPostFaint(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    return false;
  }
}

export class PostFaintContactDamageAbAttr extends PostFaintAbAttr {
  private damageRatio: integer;
  
  constructor(damageRatio: integer) {
    super();

    this.damageRatio = damageRatio;
  }

  applyPostFaint(pokemon: Pokemon, passive: boolean, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, args: any[]): boolean {
    if (move.getMove().checkFlag(MoveFlags.MAKES_CONTACT, attacker, pokemon)) {
      attacker.damageAndUpdate(Math.ceil(attacker.getMaxHp() * (1 / this.damageRatio)), HitResult.OTHER);
      return true;
    }

    return false;
  }

  getTriggerMessage(pokemon: Pokemon, abilityName: string, ...args: any[]): string {
    return getPokemonMessage(pokemon, `'s ${abilityName} hurt\nits attacker!`);
  }
}

export class RedirectMoveAbAttr extends AbAttr {
  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.canRedirect(args[0] as Moves)) {
      const target = args[1] as Utils.IntegerHolder;
      const newTarget = pokemon.getBattlerIndex();
      if (target.value !== newTarget) {
        target.value = newTarget;
        return true;
      }
    }

    return false;
  }
  
  canRedirect(moveId: Moves): boolean {
    const move = allMoves[moveId];
    return !![ MoveTarget.NEAR_OTHER, MoveTarget.OTHER ].find(t => move.moveTarget === t);
  }
}

export class RedirectTypeMoveAbAttr extends RedirectMoveAbAttr {
  public type: Type;

  constructor(type: Type) {
    super();
    this.type = type;
  }

  canRedirect(moveId: Moves): boolean {
    return super.canRedirect(moveId) && allMoves[moveId].type === this.type;
  }
}

export class ReduceStatusEffectDurationAbAttr extends AbAttr {
  private statusEffect: StatusEffect;

  constructor(statusEffect: StatusEffect) {
    super(true);

    this.statusEffect = statusEffect;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (args[0] === this.statusEffect) {
      (args[1] as Utils.IntegerHolder).value = Math.floor((args[1] as Utils.IntegerHolder).value / 2);
      return true;
    }

    return false;
  }
}

export class FlinchEffectAbAttr extends AbAttr {
  constructor() {
    super(true);
  }
}

export class FlinchStatChangeAbAttr extends FlinchEffectAbAttr {
  private stats: BattleStat[];
  private levels: integer;

  constructor(stats: BattleStat | BattleStat[], levels: integer) {
    super();

    this.stats = Array.isArray(stats)
      ? stats
      : [ stats ];
    this.levels = levels;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    pokemon.scene.unshiftPhase(new StatChangePhase(pokemon.scene, pokemon.getBattlerIndex(), true, this.stats, this.levels));
    return true;
  }
}

export class IncreasePpAbAttr extends AbAttr { }

export class ReduceBerryUseThresholdAbAttr extends AbAttr {
  constructor() {
    super();
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const hpRatio = pokemon.getHpRatio();

    if (args[0].value < hpRatio) {
      args[0].value *= 2;
      return args[0].value >= hpRatio;
    }

    return false;
  }
}

export class WeightMultiplierAbAttr extends AbAttr {
  private multiplier: integer;

  constructor(multiplier: integer) {
    super();

    this.multiplier = multiplier;
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Utils.NumberHolder).value *= this.multiplier;

    return true;
  }
}

export class SyncEncounterNatureAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    (args[0] as Pokemon).setNature(pokemon.getNature());

    return true;
  }
}

export class MoveAbilityBypassAbAttr extends AbAttr {
  private moveIgnoreFunc: (pokemon: Pokemon, move: Move) => boolean;

  constructor(moveIgnoreFunc?: (pokemon: Pokemon, move: Move) => boolean) {
    super(false);

    this.moveIgnoreFunc = moveIgnoreFunc || ((pokemon, move) => true);
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    if (this.moveIgnoreFunc(pokemon, (args[0] as Move))) {
      cancelled.value = true;
      return true;
    }
    return false;
  }
}

export class SuppressFieldAbilitiesAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  apply(pokemon: Pokemon, passive: boolean, cancelled: Utils.BooleanHolder, args: any[]): boolean {
    const ability = (args[0] as Ability);
    if (!ability.hasAttr(UnsuppressableAbilityAbAttr) && !ability.hasAttr(SuppressFieldAbilitiesAbAttr)) {
      cancelled.value = true;
      return true;
    }
    return false;
  }
}


export class AlwaysHitAbAttr extends AbAttr { }

export class UncopiableAbilityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

export class UnsuppressableAbilityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

export class UnswappableAbilityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

export class NoTransformAbilityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

export class NoFusionAbilityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

function applyAbAttrsInternal<TAttr extends AbAttr>(attrType: { new(...args: any[]): TAttr },
  pokemon: Pokemon, applyFunc: AbAttrApplyFunc<TAttr>, args: any[], isAsync: boolean = false, showAbilityInstant: boolean = false, quiet: boolean = false, passive: boolean = false): Promise<void> {
  return new Promise(resolve => {
    if (!pokemon.canApplyAbility(passive)) {
      if (!passive)
        return applyAbAttrsInternal(attrType, pokemon, applyFunc, args, isAsync, showAbilityInstant, quiet, true).then(() => resolve());
      else
        return resolve();
    }

    const ability = (!passive ? pokemon.getAbility() : pokemon.getPassiveAbility());
    const attrs = ability.getAttrs(attrType) as TAttr[];

    const clearSpliceQueueAndResolve = () => {
      pokemon.scene.clearPhaseQueueSplice();
      if (!passive)
        return applyAbAttrsInternal(attrType, pokemon, applyFunc, args, isAsync, showAbilityInstant, quiet, true).then(() => resolve());
      else
        return resolve();
    };
    const applyNextAbAttr = () => {
      if (attrs.length)
        applyAbAttr(attrs.shift());
      else
        clearSpliceQueueAndResolve();
    };
    const applyAbAttr = (attr: TAttr) => {
      if (!canApplyAttr(pokemon, attr))
        return applyNextAbAttr();
      pokemon.scene.setPhaseQueueSplice();
      const onApplySuccess = () => {
        if (attr.showAbility && !quiet) {
          if (showAbilityInstant)
            pokemon.scene.abilityBar.showAbility(pokemon, passive);
          else
            queueShowAbility(pokemon, passive);
        }
        if (!quiet) {
          const message = attr.getTriggerMessage(pokemon, (!passive ? pokemon.getAbility() : pokemon.getPassiveAbility()).name, args);
          if (message) {
            if (isAsync)
              pokemon.scene.ui.showText(message, null, () => pokemon.scene.ui.showText(null, 0), null, true);
            else
              pokemon.scene.queueMessage(message);
          }
        }
      };
      const result = applyFunc(attr, passive);
      if (result instanceof Promise) {
        result.then(success => {
          if (success)
            onApplySuccess();
          applyNextAbAttr();
        });
      } else {
        if (result)
          onApplySuccess();
        applyNextAbAttr();
      }
    };
    applyNextAbAttr();
  });
}

export function applyAbAttrs(attrType: { new(...args: any[]): AbAttr }, pokemon: Pokemon, cancelled: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<AbAttr>(attrType, pokemon, (attr, passive) => attr.apply(pokemon, passive, cancelled, args), args);
}

export function applyPostBattleInitAbAttrs(attrType: { new(...args: any[]): PostBattleInitAbAttr },
  pokemon: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostBattleInitAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostBattleInit(pokemon, passive, args), args);
}

export function applyPreDefendAbAttrs(attrType: { new(...args: any[]): PreDefendAbAttr },
  pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, cancelled: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  const simulated = args.length > 1 && args[1];
  return applyAbAttrsInternal<PreDefendAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreDefend(pokemon, passive, attacker, move, cancelled, args), args, false, false, simulated);
}

export function applyPostDefendAbAttrs(attrType: { new(...args: any[]): PostDefendAbAttr },
  pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostDefendAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostDefend(pokemon, passive, attacker, move, hitResult, args), args);
}

export function applyBattleStatMultiplierAbAttrs(attrType: { new(...args: any[]): BattleStatMultiplierAbAttr },
  pokemon: Pokemon, battleStat: BattleStat, statValue: Utils.NumberHolder, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<BattleStatMultiplierAbAttr>(attrType, pokemon, (attr, passive) => attr.applyBattleStat(pokemon, passive, battleStat, statValue, args), args);
}

export function applyPreAttackAbAttrs(attrType: { new(...args: any[]): PreAttackAbAttr },
  pokemon: Pokemon, defender: Pokemon, move: PokemonMove, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PreAttackAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreAttack(pokemon, passive, defender, move, args), args);
}

export function applyPostAttackAbAttrs(attrType: { new(...args: any[]): PostAttackAbAttr },
  pokemon: Pokemon, defender: Pokemon, move: PokemonMove, hitResult: HitResult, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostAttackAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostAttack(pokemon, passive, defender, move, hitResult, args), args);
}

export function applyPostKnockOutAbAttrs(attrType: { new(...args: any[]): PostKnockOutAbAttr },
  pokemon: Pokemon, knockedOut: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostKnockOutAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostKnockOut(pokemon, passive, knockedOut, args), args);
} 

export function applyPostVictoryAbAttrs(attrType: { new(...args: any[]): PostVictoryAbAttr },
  pokemon: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostVictoryAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostVictory(pokemon, passive, args), args);
}

export function applyPostSummonAbAttrs(attrType: { new(...args: any[]): PostSummonAbAttr },
  pokemon: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostSummonAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostSummon(pokemon, passive, args), args);
}

export function applyPreSwitchOutAbAttrs(attrType: { new(...args: any[]): PreSwitchOutAbAttr },
  pokemon: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PreSwitchOutAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreSwitchOut(pokemon, passive, args), args, false, true);
}

export function applyPreStatChangeAbAttrs(attrType: { new(...args: any[]): PreStatChangeAbAttr },
  pokemon: Pokemon, stat: BattleStat, cancelled: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PreStatChangeAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreStatChange(pokemon, passive, stat, cancelled, args), args);
}

export function applyPostStatChangeAbAttrs(attrType: { new(...args: any[]): PostStatChangeAbAttr },
  pokemon: Pokemon, stats: BattleStat[], levels: integer, selfTarget: boolean, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostStatChangeAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostStatChange(pokemon, stats, levels, selfTarget, args), args);
}

export function applyPreSetStatusAbAttrs(attrType: { new(...args: any[]): PreSetStatusAbAttr },
  pokemon: Pokemon, effect: StatusEffect, cancelled: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  const simulated = args.length > 1 && args[1];
  return applyAbAttrsInternal<PreSetStatusAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreSetStatus(pokemon, passive, effect, cancelled, args), args, false, false, !simulated);
}

export function applyPreApplyBattlerTagAbAttrs(attrType: { new(...args: any[]): PreApplyBattlerTagAbAttr },
  pokemon: Pokemon, tag: BattlerTag, cancelled: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PreApplyBattlerTagAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreApplyBattlerTag(pokemon, passive, tag, cancelled, args), args);
}

export function applyPreWeatherEffectAbAttrs(attrType: { new(...args: any[]): PreWeatherEffectAbAttr },
  pokemon: Pokemon, weather: Weather, cancelled: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PreWeatherDamageAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPreWeatherEffect(pokemon, passive, weather, cancelled, args), args, false, true);
}

export function applyPostTurnAbAttrs(attrType: { new(...args: any[]): PostTurnAbAttr },
  pokemon: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostTurnAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostTurn(pokemon, passive, args), args);
}

export function applyPostWeatherChangeAbAttrs(attrType: { new(...args: any[]): PostWeatherChangeAbAttr },
  pokemon: Pokemon, weather: WeatherType, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostWeatherChangeAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostWeatherChange(pokemon, passive, weather, args), args);
}

export function applyPostWeatherLapseAbAttrs(attrType: { new(...args: any[]): PostWeatherLapseAbAttr },
  pokemon: Pokemon, weather: Weather, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostWeatherLapseAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostWeatherLapse(pokemon, passive, weather, args), args);
}

export function applyPostTerrainChangeAbAttrs(attrType: { new(...args: any[]): PostTerrainChangeAbAttr },
  pokemon: Pokemon, terrain: TerrainType, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostTerrainChangeAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostTerrainChange(pokemon, passive, terrain, args), args);
}

export function applyCheckTrappedAbAttrs(attrType: { new(...args: any[]): CheckTrappedAbAttr },
  pokemon: Pokemon, trapped: Utils.BooleanHolder, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<CheckTrappedAbAttr>(attrType, pokemon, (attr, passive) => attr.applyCheckTrapped(pokemon, passive, trapped, args), args, true);
}

export function applyPostBattleAbAttrs(attrType: { new(...args: any[]): PostBattleAbAttr },
  pokemon: Pokemon, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostBattleAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostBattle(pokemon, passive, args), args);
}

export function applyPostFaintAbAttrs(attrType: { new(...args: any[]): PostFaintAbAttr },
  pokemon: Pokemon, attacker: Pokemon, move: PokemonMove, hitResult: HitResult, ...args: any[]): Promise<void> {
  return applyAbAttrsInternal<PostFaintAbAttr>(attrType, pokemon, (attr, passive) => attr.applyPostFaint(pokemon, passive, attacker, move, hitResult, args), args);
}

function canApplyAttr(pokemon: Pokemon, attr: AbAttr): boolean {
  const condition = attr.getCondition();
  return !condition || condition(pokemon);
}

function queueShowAbility(pokemon: Pokemon, passive: boolean): void {
  pokemon.scene.unshiftPhase(new ShowAbilityPhase(pokemon.scene, pokemon.id, passive));
  pokemon.scene.clearPhaseQueueSplice();
}

export const allAbilities = [ new Ability(Abilities.NONE, "-", "", 3) ];

export function initAbilities() {
  allAbilities.push(
    new Ability(Abilities.STENCH, "Stench", "By releasing stench when attacking, this Pokémon may cause the target to flinch.", 3)
      .attr(PostAttackApplyBattlerTagAbAttr, false, (user, target, move) => !move.getMove().findAttr(attr => attr instanceof FlinchAttr) ? 10 : 0, BattlerTagType.FLINCHED),
    new Ability(Abilities.DRIZZLE, "Drizzle", "The Pokémon makes it rain when it enters a battle.", 3)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.RAIN)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.RAIN),
    new Ability(Abilities.SPEED_BOOST, "Speed Boost", "Its Speed stat is boosted every turn.", 3)
      .attr(PostTurnStatChangeAbAttr, BattleStat.SPD, 1),
    new Ability(Abilities.BATTLE_ARMOR, "Battle Armor", "Hard armor protects the Pokémon from critical hits.", 3)
      .attr(BlockCritAbAttr)
      .ignorable(),
    new Ability(Abilities.STURDY, "Sturdy", "It cannot be knocked out with one hit. One-hit KO moves cannot knock it out, either.", 3)    
      .attr(PreDefendFullHpEndureAbAttr)
      .attr(BlockOneHitKOAbAttr)
      .ignorable(),
    new Ability(Abilities.DAMP, "Damp (N)", "Prevents the use of explosive moves, such as Self-Destruct, by dampening its surroundings.", 3)
      .ignorable(),
    new Ability(Abilities.LIMBER, "Limber", "Its limber body protects the Pokémon from paralysis.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.PARALYSIS)
      .ignorable(),
    new Ability(Abilities.SAND_VEIL, "Sand Veil", "Boosts the Pokémon's evasiveness in a sandstorm.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.EVA, 1.2)
      .attr(BlockWeatherDamageAttr, WeatherType.SANDSTORM)
      .condition(getWeatherCondition(WeatherType.SANDSTORM))
      .ignorable(),
    new Ability(Abilities.STATIC, "Static", "The Pokémon is charged with static electricity, so contact with it may cause paralysis.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 30, StatusEffect.PARALYSIS),
    new Ability(Abilities.VOLT_ABSORB, "Volt Absorb", "Restores HP if hit by an Electric-type move instead of taking damage.", 3)
      .attr(TypeImmunityHealAbAttr, Type.ELECTRIC)
      .ignorable(),
    new Ability(Abilities.WATER_ABSORB, "Water Absorb", "Restores HP if hit by a Water-type move instead of taking damage.", 3)
      .attr(TypeImmunityHealAbAttr, Type.WATER)
      .ignorable(),
    new Ability(Abilities.OBLIVIOUS, "Oblivious", "The Pokémon is oblivious, and that keeps it from being infatuated or falling for taunts.", 3)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.INFATUATED)
      .ignorable(),
    new Ability(Abilities.CLOUD_NINE, "Cloud Nine", "Eliminates the effects of weather.", 3)
      .attr(SuppressWeatherEffectAbAttr, true),
    new Ability(Abilities.COMPOUND_EYES, "Compound Eyes", "The Pokémon's compound eyes boost its accuracy.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ACC, 1.3),
    new Ability(Abilities.INSOMNIA, "Insomnia", "The Pokémon is suffering from insomnia and cannot fall asleep.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.SLEEP)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.DROWSY)
      .ignorable(),
    new Ability(Abilities.COLOR_CHANGE, "Color Change", "The Pokémon's type becomes the type of the move used on it.", 3)
      .attr(PostDefendTypeChangeAbAttr),
    new Ability(Abilities.IMMUNITY, "Immunity", "The immune system of the Pokémon prevents it from getting poisoned.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.POISON, StatusEffect.TOXIC)
      .ignorable(),
    new Ability(Abilities.FLASH_FIRE, "Flash Fire", "Powers up the Pokémon's Fire-type moves if it's hit by one.", 3)
      .attr(TypeImmunityAddBattlerTagAbAttr, Type.FIRE, BattlerTagType.FIRE_BOOST, 1, (pokemon: Pokemon) => !pokemon.status || pokemon.status.effect !== StatusEffect.FREEZE)
      .ignorable(),
    new Ability(Abilities.SHIELD_DUST, "Shield Dust (N)", "This Pokémon's dust blocks the additional effects of attacks taken.", 3)
      .ignorable(),
    new Ability(Abilities.OWN_TEMPO, "Own Tempo", "This Pokémon has its own tempo, and that prevents it from becoming confused.", 3)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.CONFUSED)
      .ignorable(),
    new Ability(Abilities.SUCTION_CUPS, "Suction Cups (N)", "This Pokémon uses suction cups to stay in one spot to negate all moves and items that force switching out.", 3)
      .ignorable(),
    new Ability(Abilities.INTIMIDATE, "Intimidate", "The Pokémon intimidates opposing Pokémon upon entering battle, lowering their Attack stat.", 3)
      .attr(PostSummonStatChangeAbAttr, BattleStat.ATK, -1),
    new Ability(Abilities.SHADOW_TAG, "Shadow Tag", "This Pokémon steps on the opposing Pokémon's shadow to prevent it from escaping.", 3)
      .attr(ArenaTrapAbAttr),
    new Ability(Abilities.ROUGH_SKIN, "Rough Skin", "This Pokémon inflicts damage with its rough skin to the attacker on contact.", 3)
      .attr(PostDefendContactDamageAbAttr, 8)
      .bypassFaint(),
    new Ability(Abilities.WONDER_GUARD, "Wonder Guard", "Its mysterious power only lets supereffective moves hit the Pokémon.", 3)
      .attr(NonSuperEffectiveImmunityAbAttr)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .ignorable(),
    new Ability(Abilities.LEVITATE, "Levitate", "By floating in the air, the Pokémon receives full immunity to all Ground-type moves.", 3)
      .attr(TypeImmunityAbAttr, Type.GROUND, (pokemon: Pokemon) => !pokemon.getTag(BattlerTagType.IGNORE_FLYING) && !pokemon.scene.arena.getTag(ArenaTagType.GRAVITY) && !pokemon.getTag(BattlerTagType.GROUNDED))
      .ignorable(),
    new Ability(Abilities.EFFECT_SPORE, "Effect Spore", "Contact with the Pokémon may inflict poison, sleep, or paralysis on its attacker.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 10, StatusEffect.POISON, StatusEffect.PARALYSIS, StatusEffect.SLEEP),
    new Ability(Abilities.SYNCHRONIZE, "Synchronize (N)", "The attacker will receive the same status condition if it inflicts a burn, poison, or paralysis to the Pokémon.", 3)
      .attr(SyncEncounterNatureAbAttr),
    new Ability(Abilities.CLEAR_BODY, "Clear Body", "Prevents other Pokémon's moves or Abilities from lowering the Pokémon's stats.", 3)
      .attr(ProtectStatAbAttr)
      .ignorable(),
    new Ability(Abilities.NATURAL_CURE, "Natural Cure", "All status conditions heal when the Pokémon switches out.", 3)
      .attr(PreSwitchOutResetStatusAbAttr),
    new Ability(Abilities.LIGHTNING_ROD, "Lightning Rod", "The Pokémon draws in all Electric-type moves. Instead of being hit by Electric-type moves, it boosts its Sp. Atk.", 3)
      .attr(RedirectTypeMoveAbAttr, Type.ELECTRIC)
      .attr(TypeImmunityStatChangeAbAttr, Type.ELECTRIC, BattleStat.SPATK, 1)
      .ignorable(),
    new Ability(Abilities.SERENE_GRACE, "Serene Grace (N)", "Boosts the likelihood of additional effects occurring when attacking.", 3),
    new Ability(Abilities.SWIFT_SWIM, "Swift Swim", "Boosts the Pokémon's Speed stat in rain.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .condition(getWeatherCondition(WeatherType.RAIN, WeatherType.HEAVY_RAIN)),
    new Ability(Abilities.CHLOROPHYLL, "Chlorophyll", "Boosts the Pokémon's Speed stat in harsh sunlight.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .condition(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN)),
    new Ability(Abilities.ILLUMINATE, "Illuminate", "By illuminating its surroundings, the Pokémon raises the likelihood of meeting wild Pokémon and prevents its accuracy from being lowered.", 3)
      .attr(ProtectStatAbAttr, BattleStat.ACC)
      .attr(DoubleBattleChanceAbAttr)
      .ignorable(),
    new Ability(Abilities.TRACE, "Trace", "When it enters a battle, the Pokémon copies an opposing Pokémon's Ability.", 3)
      .attr(TraceAbAttr)
      .attr(UncopiableAbilityAbAttr),
    new Ability(Abilities.HUGE_POWER, "Huge Power", "Doubles the Pokémon's Attack stat.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ATK, 2),
    new Ability(Abilities.POISON_POINT, "Poison Point", "Contact with the Pokémon may poison the attacker.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 30, StatusEffect.POISON),
    new Ability(Abilities.INNER_FOCUS, "Inner Focus", "The Pokémon's intensely focused, and that protects the Pokémon from flinching.", 3)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.FLINCHED)
      .ignorable(),
    new Ability(Abilities.MAGMA_ARMOR, "Magma Armor", "The Pokémon is covered with hot magma, which prevents the Pokémon from becoming frozen.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.FREEZE)
      .ignorable(),
    new Ability(Abilities.WATER_VEIL, "Water Veil", "The Pokémon is covered with a water veil, which prevents the Pokémon from getting a burn.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.BURN)
      .ignorable(),
    new Ability(Abilities.MAGNET_PULL, "Magnet Pull (N)", "Prevents Steel-type Pokémon from escaping using its magnetic force.", 3)
      /*.attr(ArenaTrapAbAttr)
      .condition((pokemon: Pokemon) => pokemon.getOpponent()?.isOfType(Type.STEEL))*/,
    new Ability(Abilities.SOUNDPROOF, "Soundproof", "Soundproofing gives the Pokémon full immunity to all sound-based moves.", 3)
      .attr(MoveImmunityAbAttr, (pokemon, attacker, move) => pokemon !== attacker && move.getMove().hasFlag(MoveFlags.SOUND_BASED))
      .ignorable(),
    new Ability(Abilities.RAIN_DISH, "Rain Dish", "The Pokémon gradually regains HP in rain.", 3)
      .attr(PostWeatherLapseHealAbAttr, 1, WeatherType.RAIN, WeatherType.HEAVY_RAIN),
    new Ability(Abilities.SAND_STREAM, "Sand Stream", "The Pokémon summons a sandstorm when it enters a battle.", 3)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SANDSTORM)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SANDSTORM),
    new Ability(Abilities.PRESSURE, "Pressure", "By putting pressure on the opposing Pokémon, it raises their PP usage.", 3)
      .attr(IncreasePpAbAttr)
      .attr(PostSummonMessageAbAttr, (pokemon: Pokemon) => getPokemonMessage(pokemon, ' is exerting its Pressure!')),
    new Ability(Abilities.THICK_FAT, "Thick Fat", "The Pokémon is protected by a layer of thick fat, which halves the damage taken from Fire- and Ice-type moves.", 3)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 0.5)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.ICE, 0.5)
      .ignorable(),
    new Ability(Abilities.EARLY_BIRD, "Early Bird", "The Pokémon awakens from sleep twice as fast as other Pokémon.", 3)
      .attr(ReduceStatusEffectDurationAbAttr, StatusEffect.SLEEP),
    new Ability(Abilities.FLAME_BODY, "Flame Body", "Contact with the Pokémon may burn the attacker.", 3)
      .attr(PostDefendContactApplyStatusEffectAbAttr, 30, StatusEffect.BURN),
    new Ability(Abilities.RUN_AWAY, "Run Away", "Enables a sure getaway from wild Pokémon.", 3)
      .attr(RunSuccessAbAttr),
    new Ability(Abilities.KEEN_EYE, "Keen Eye", "Keen eyes prevent other Pokémon from lowering this Pokémon's accuracy.", 3)
      .attr(ProtectStatAbAttr, BattleStat.ACC)
      .ignorable(),
    new Ability(Abilities.HYPER_CUTTER, "Hyper Cutter", "The Pokémon's proud of its powerful pincers. They prevent other Pokémon from lowering its Attack stat.", 3)
      .attr(ProtectStatAbAttr, BattleStat.ATK)
      .ignorable(),
    new Ability(Abilities.PICKUP, "Pickup", "The Pokémon may pick up the item an opposing Pokémon held during a battle.", 3)
      .attr(PostBattleLootAbAttr),
    new Ability(Abilities.TRUANT, "Truant", "The Pokémon can't use a move if it had used a move on the previous turn.", 3)
      .attr(PostSummonAddBattlerTagAbAttr, BattlerTagType.TRUANT, 1, false),
    new Ability(Abilities.HUSTLE, "Hustle", "Boosts the Attack stat, but lowers accuracy.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ATK, 1.5)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ACC, 0.8),
    new Ability(Abilities.CUTE_CHARM, "Cute Charm", "Contact with the Pokémon may cause infatuation.", 3)
      .attr(PostDefendContactApplyTagChanceAbAttr, 30, BattlerTagType.INFATUATED),
    new Ability(Abilities.PLUS, "Plus (N)", "Boosts the Sp. Atk stat of the Pokémon if an ally with the Plus or Minus Ability is also in battle.", 3),
    new Ability(Abilities.MINUS, "Minus (N)", "Boosts the Sp. Atk stat of the Pokémon if an ally with the Plus or Minus Ability is also in battle.", 3),
    new Ability(Abilities.FORECAST, "Forecast (N)", "The Pokémon transforms with the weather to change its type to Water, Fire, or Ice.", 3)
      .attr(UncopiableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.STICKY_HOLD, "Sticky Hold", "Items held by the Pokémon are stuck fast and cannot be removed by other Pokémon.", 3)
      .attr(BlockItemTheftAbAttr)
      .bypassFaint()
      .ignorable(),
    new Ability(Abilities.SHED_SKIN, "Shed Skin", "The Pokémon may heal its own status conditions by shedding its skin.", 3)
      .conditionalAttr(pokemon => !Utils.randSeedInt(3), PostTurnResetStatusAbAttr),
    new Ability(Abilities.GUTS, "Guts", "It's so gutsy that having a status condition boosts the Pokémon's Attack stat.", 3)
      .attr(BypassBurnDamageReductionAbAttr)
      .conditionalAttr(pokemon => !!pokemon.status, BattleStatMultiplierAbAttr, BattleStat.ATK, 1.5),
    new Ability(Abilities.MARVEL_SCALE, "Marvel Scale", "The Pokémon's marvelous scales boost the Defense stat if it has a status condition.", 3)
      .conditionalAttr(pokemon => !!pokemon.status, BattleStatMultiplierAbAttr, BattleStat.DEF, 1.5)
      .ignorable(),
    new Ability(Abilities.LIQUID_OOZE, "Liquid Ooze (N)", "The oozed liquid has a strong stench, which damages attackers using any draining move.", 3),
    new Ability(Abilities.OVERGROW, "Overgrow", "Powers up Grass-type moves when the Pokémon's HP is low.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.GRASS),
    new Ability(Abilities.BLAZE, "Blaze", "Powers up Fire-type moves when the Pokémon's HP is low.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.FIRE),
    new Ability(Abilities.TORRENT, "Torrent", "Powers up Water-type moves when the Pokémon's HP is low.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.WATER),
    new Ability(Abilities.SWARM, "Swarm", "Powers up Bug-type moves when the Pokémon's HP is low.", 3)
      .attr(LowHpMoveTypePowerBoostAbAttr, Type.BUG),
    new Ability(Abilities.ROCK_HEAD, "Rock Head", "Protects the Pokémon from recoil damage.", 3)
      .attr(BlockRecoilDamageAttr),
    new Ability(Abilities.DROUGHT, "Drought", "Turns the sunlight harsh when the Pokémon enters a battle.", 3)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SUNNY)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SUNNY),
    new Ability(Abilities.ARENA_TRAP, "Arena Trap", "Prevents opposing Pokémon from fleeing.", 3)
      .attr(ArenaTrapAbAttr),
    new Ability(Abilities.VITAL_SPIRIT, "Vital Spirit", "The Pokémon is full of vitality, and that prevents it from falling asleep.", 3)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.SLEEP)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.DROWSY)
      .ignorable(),
    new Ability(Abilities.WHITE_SMOKE, "White Smoke", "The Pokémon is protected by its white smoke, which prevents other Pokémon from lowering its stats.", 3)
      .attr(ProtectStatAbAttr)
      .ignorable(),
    new Ability(Abilities.PURE_POWER, "Pure Power", "Using its pure power, the Pokémon doubles its Attack stat.", 3)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ATK, 2),
    new Ability(Abilities.SHELL_ARMOR, "Shell Armor", "A hard shell protects the Pokémon from critical hits.", 3)
      .attr(BlockCritAbAttr)
      .ignorable(),
    new Ability(Abilities.AIR_LOCK, "Air Lock", "Eliminates the effects of weather.", 3)
      .attr(SuppressWeatherEffectAbAttr, true),
    new Ability(Abilities.TANGLED_FEET, "Tangled Feet", "Raises evasiveness if the Pokémon is confused.", 4)
      .conditionalAttr(pokemon => !!pokemon.getTag(BattlerTagType.CONFUSED), BattleStatMultiplierAbAttr, BattleStat.EVA, 2)
      .ignorable(),
    new Ability(Abilities.MOTOR_DRIVE, "Motor Drive", "Boosts its Speed stat if hit by an Electric-type move instead of taking damage.", 4)
      .attr(TypeImmunityStatChangeAbAttr, Type.ELECTRIC, BattleStat.SPD, 1)
      .ignorable(),
    new Ability(Abilities.RIVALRY, "Rivalry", "Becomes competitive and deals more damage to Pokémon of the same gender, but deals less to Pokémon of the opposite gender.", 4)
      .attr(MovePowerBoostAbAttr, (user, target, move) => user.gender !== Gender.GENDERLESS && target.gender !== Gender.GENDERLESS && user.gender === target.gender, 1.25)
      .attr(MovePowerBoostAbAttr, (user, target, move) => user.gender !== Gender.GENDERLESS && target.gender !== Gender.GENDERLESS && user.gender !== target.gender, 0.75),
    new Ability(Abilities.STEADFAST, "Steadfast", "The Pokémon's determination boosts the Speed stat each time the Pokémon flinches.", 4)
      .attr(FlinchStatChangeAbAttr, BattleStat.SPD, 1),
    new Ability(Abilities.SNOW_CLOAK, "Snow Cloak", "Boosts the Pokémon's evasiveness in snow.", 4)
      .attr(BattleStatMultiplierAbAttr, BattleStat.EVA, 1.2)
      .attr(BlockWeatherDamageAttr, WeatherType.HAIL)
      .condition(getWeatherCondition(WeatherType.HAIL, WeatherType.SNOW))
      .ignorable(),
    new Ability(Abilities.GLUTTONY, "Gluttony", "Makes the Pokémon eat a held Berry when its HP drops to half or less, which is sooner than usual.", 4)
      .attr(ReduceBerryUseThresholdAbAttr),
    new Ability(Abilities.ANGER_POINT, "Anger Point", "The Pokémon is angered when it takes a critical hit, and that maxes its Attack stat.", 4)
      .attr(PostDefendCritStatChangeAbAttr, BattleStat.ATK, 6),
    new Ability(Abilities.UNBURDEN, "Unburden (N)", "Boosts the Speed stat if the Pokémon's held item is used or lost.", 4),
    new Ability(Abilities.HEATPROOF, "Heatproof", "The heatproof body of the Pokémon halves the damage from Fire-type moves that hit it.", 4)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 0.5)
      .ignorable(),
    new Ability(Abilities.SIMPLE, "Simple", "The stat changes the Pokémon receives are doubled.", 4)
      .attr(StatChangeMultiplierAbAttr, 2)
      .ignorable(),
    new Ability(Abilities.DRY_SKIN, "Dry Skin", "Restores HP in rain or when hit by Water-type moves. Reduces HP in harsh sunlight, and increases the damage received from Fire-type moves.", 4)
      .attr(PostWeatherLapseDamageAbAttr, 2, WeatherType.SUNNY, WeatherType.HARSH_SUN)
      .attr(PostWeatherLapseHealAbAttr, 2, WeatherType.RAIN, WeatherType.HEAVY_RAIN)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 1.25)
      .attr(TypeImmunityHealAbAttr, Type.WATER)
      .ignorable(),
    new Ability(Abilities.DOWNLOAD, "Download", "Compares an opposing Pokémon's Defense and Sp. Def stats before raising its own Attack or Sp. Atk stat—whichever will be more effective.", 4)
      .attr(DownloadAbAttr),
    new Ability(Abilities.IRON_FIST, "Iron Fist", "Powers up punching moves.", 4)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.hasFlag(MoveFlags.PUNCHING_MOVE), 1.2),
    new Ability(Abilities.POISON_HEAL, "Poison Heal (N)", "Restores HP if the Pokémon is poisoned instead of losing HP.", 4),
    new Ability(Abilities.ADAPTABILITY, "Adaptability", "Powers up moves of the same type as the Pokémon.", 4)
      .attr(StabBoostAbAttr),
    new Ability(Abilities.SKILL_LINK, "Skill Link", "Maximizes the number of times multistrike moves hit.", 4)
      .attr(MaxMultiHitAbAttr),
    new Ability(Abilities.HYDRATION, "Hydration", "Heals status conditions if it's raining.", 4)
      .attr(PostTurnResetStatusAbAttr)
      .condition(getWeatherCondition(WeatherType.RAIN, WeatherType.HEAVY_RAIN)),
    new Ability(Abilities.SOLAR_POWER, "Solar Power", "Boosts the Sp. Atk stat in harsh sunlight, but HP decreases every turn.", 4)
      .attr(PostWeatherLapseDamageAbAttr, 2, WeatherType.SUNNY, WeatherType.HARSH_SUN)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPATK, 1.5)
      .condition(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN)),
    new Ability(Abilities.QUICK_FEET, "Quick Feet", "Boosts the Speed stat if the Pokémon has a status condition.", 4)
      .conditionalAttr(pokemon => pokemon.status ? pokemon.status.effect === StatusEffect.PARALYSIS : false, BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .conditionalAttr(pokemon => !!pokemon.status, BattleStatMultiplierAbAttr, BattleStat.SPD, 1.5),
    new Ability(Abilities.NORMALIZE, "Normalize", "All the Pokémon's moves become Normal type. The power of those moves is boosted a little.", 4)
      .attr(MoveTypeChangeAttr, Type.NORMAL, 1.2, (user, target, move) => move.id !== Moves.HIDDEN_POWER && move.id !== Moves.WEATHER_BALL && 
            move.id !== Moves.NATURAL_GIFT && move.id !== Moves.JUDGMENT && move.id !== Moves.TECHNO_BLAST),
    new Ability(Abilities.SNIPER, "Sniper (N)", "Powers up moves if they become critical hits when attacking.", 4),
    new Ability(Abilities.MAGIC_GUARD, "Magic Guard", "The Pokémon only takes damage from attacks.", 4)
      .attr(BlockNonDirectDamageAbAttr),
    new Ability(Abilities.NO_GUARD, "No Guard", "The Pokémon employs no-guard tactics to ensure incoming and outgoing attacks always land.", 4)
      .attr(AlwaysHitAbAttr)
      .attr(DoubleBattleChanceAbAttr),
    new Ability(Abilities.STALL, "Stall (N)", "The Pokémon moves after all other Pokémon do.", 4),
    new Ability(Abilities.TECHNICIAN, "Technician", "Powers up the Pokémon's weaker moves.", 4)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.power <= 60, 1.5),
    new Ability(Abilities.LEAF_GUARD, "Leaf Guard", "Prevents status conditions in harsh sunlight.", 4)
      .attr(StatusEffectImmunityAbAttr)
      .condition(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN))
      .ignorable(),
    new Ability(Abilities.KLUTZ, "Klutz (N)", "The Pokémon can't use any held items.", 4),
    new Ability(Abilities.MOLD_BREAKER, "Mold Breaker", "Moves can be used on the target regardless of its Abilities.", 4)
      .attr(PostSummonMessageAbAttr, (pokemon: Pokemon) => getPokemonMessage(pokemon, ' breaks the mold!'))
      .attr(MoveAbilityBypassAbAttr),
    new Ability(Abilities.SUPER_LUCK, "Super Luck (P)", "The Pokémon is so lucky that the critical-hit ratios of its moves are boosted.", 4)
      .attr(BonusCritAbAttr),
    new Ability(Abilities.AFTERMATH, "Aftermath", "Damages the attacker if it contacts the Pokémon with a finishing hit.", 4)
      .attr(PostFaintContactDamageAbAttr,4)
      .bypassFaint(),
    new Ability(Abilities.ANTICIPATION, "Anticipation (N)", "The Pokémon can sense an opposing Pokémon's dangerous moves.", 4),
    new Ability(Abilities.FOREWARN, "Forewarn (N)", "When it enters a battle, the Pokémon can tell one of the moves an opposing Pokémon has.", 4),
    new Ability(Abilities.UNAWARE, "Unaware", "When attacking, the Pokémon ignores the target Pokémon's stat changes.", 4)
      .attr(IgnoreOpponentStatChangesAbAttr)
      .ignorable(),
    new Ability(Abilities.TINTED_LENS, "Tinted Lens", "The Pokémon can use \"not very effective\" moves to deal regular damage.", 4)
      .attr(MovePowerBoostAbAttr, (user, target, move) => target.getAttackTypeEffectiveness(move.type) <= 0.5, 2),
    new Ability(Abilities.FILTER, "Filter", "Reduces the power of supereffective attacks taken.", 4)
      .attr(ReceivedMoveDamageMultiplierAbAttr,(target, user, move) => target.getAttackTypeEffectiveness(move.type) >= 2, 0.75)
      .ignorable(),
    new Ability(Abilities.SLOW_START, "Slow Start", "For five turns, the Pokémon's Attack and Speed stats are halved.", 4)
      .attr(PostSummonAddBattlerTagAbAttr, BattlerTagType.SLOW_START, 5),
    new Ability(Abilities.SCRAPPY, "Scrappy (N)", "The Pokémon can hit Ghost-type Pokémon with Normal- and Fighting-type moves.", 4),
    new Ability(Abilities.STORM_DRAIN, "Storm Drain", "Draws in all Water-type moves. Instead of being hit by Water-type moves, it boosts its Sp. Atk.", 4)
      .attr(RedirectTypeMoveAbAttr, Type.WATER)
      .attr(TypeImmunityStatChangeAbAttr, Type.WATER, BattleStat.SPATK, 1)
      .ignorable(),
    new Ability(Abilities.ICE_BODY, "Ice Body", "The Pokémon gradually regains HP in snow.", 4)
      .attr(BlockWeatherDamageAttr, WeatherType.HAIL)
      .attr(PostWeatherLapseHealAbAttr, 1, WeatherType.HAIL, WeatherType.SNOW),
    new Ability(Abilities.SOLID_ROCK, "Solid Rock", "Reduces the power of supereffective attacks taken.", 4)
      .attr(ReceivedMoveDamageMultiplierAbAttr,(target, user, move) => target.getAttackTypeEffectiveness(move.type) >= 2, 0.75)
      .ignorable(),
    new Ability(Abilities.SNOW_WARNING, "Snow Warning", "The Pokémon makes it snow when it enters a battle.", 4)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SNOW)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SNOW),
    new Ability(Abilities.HONEY_GATHER, "Honey Gather (N)", "The Pokémon may gather Honey after a battle.", 4),
    new Ability(Abilities.FRISK, "Frisk (N)", "When it enters a battle, the Pokémon can check an opposing Pokémon's held item.", 4),
    new Ability(Abilities.RECKLESS, "Reckless", "Powers up moves that have recoil damage.", 4)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.getAttrs(RecoilAttr).length && move.id !== Moves.STRUGGLE, 1.2),
    new Ability(Abilities.MULTITYPE, "Multitype (N)", "Changes the Pokémon's type to match the Plate or Z-Crystal it holds.", 4)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.FLOWER_GIFT, "Flower Gift (P)", "Boosts the Attack and Sp. Def stats of itself and allies in harsh sunlight.", 4)
      .conditionalAttr(getWeatherCondition(WeatherType.SUNNY || WeatherType.HARSH_SUN), BattleStatMultiplierAbAttr, BattleStat.ATK, 1.5)
      .conditionalAttr(getWeatherCondition(WeatherType.SUNNY || WeatherType.HARSH_SUN), BattleStatMultiplierAbAttr, BattleStat.SPDEF, 1.5)
      .attr(UncopiableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr)
      .ignorable(),
    new Ability(Abilities.BAD_DREAMS, "Bad Dreams (N)", "Reduces the HP of sleeping opposing Pokémon.", 4),
    new Ability(Abilities.PICKPOCKET, "Pickpocket", "Steals an item from an attacker that made direct contact.", 5)
      .attr(PostDefendStealHeldItemAbAttr, (target, user, move) => move.hasFlag(MoveFlags.MAKES_CONTACT)),
    new Ability(Abilities.SHEER_FORCE, "Sheer Force (N)", "Removes additional effects to increase the power of moves when attacking.", 5),
    new Ability(Abilities.CONTRARY, "Contrary", "Makes stat changes have an opposite effect.", 5)
      .attr(StatChangeMultiplierAbAttr, -1)
      .ignorable(),
    new Ability(Abilities.UNNERVE, "Unnerve", "Unnerves opposing Pokémon and makes them unable to eat Berries.", 5)
      .attr(PreventBerryUseAbAttr),
    new Ability(Abilities.DEFIANT, "Defiant", "Boosts the Pokémon's Attack stat sharply when its stats are lowered.", 5)
      .attr(PostStatChangeStatChangeAbAttr, (target, statsChanged, levels) => levels < 0, [BattleStat.ATK], 2),
    new Ability(Abilities.DEFEATIST, "Defeatist", "Halves the Pokémon's Attack and Sp. Atk stats when its HP becomes half or less.", 5)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ATK, 0.5)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPATK, 0.5)
      .condition((pokemon) => pokemon.getHpRatio() <= 0.5),
    new Ability(Abilities.CURSED_BODY, "Cursed Body (N)", "May disable a move used on the Pokémon.", 5),
    new Ability(Abilities.HEALER, "Healer (N)", "Sometimes heals an ally's status condition.", 5),
    new Ability(Abilities.FRIEND_GUARD, "Friend Guard (N)", "Reduces damage done to allies.", 5)
      .ignorable(),
    new Ability(Abilities.WEAK_ARMOR, "Weak Armor", "Physical attacks to the Pokémon lower its Defense stat but sharply raise its Speed stat.", 5)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.category === MoveCategory.PHYSICAL, BattleStat.DEF, -1)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.category === MoveCategory.PHYSICAL, BattleStat.SPD, 2),
    new Ability(Abilities.HEAVY_METAL, "Heavy Metal", "Doubles the Pokémon's weight.", 5)
      .attr(WeightMultiplierAbAttr, 2)
      .ignorable(),
    new Ability(Abilities.LIGHT_METAL, "Light Metal", "Halves the Pokémon's weight.", 5)
      .attr(WeightMultiplierAbAttr, 0.5)
      .ignorable(),
    new Ability(Abilities.MULTISCALE, "Multiscale", "Reduces the amount of damage the Pokémon takes while its HP is full.", 5)
      .attr(ReceivedMoveDamageMultiplierAbAttr,(target, user, move) => target.getHpRatio() === 1, 0.5)
      .ignorable(),
    new Ability(Abilities.TOXIC_BOOST, "Toxic Boost", "Powers up physical attacks when the Pokémon is poisoned.", 5)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.category === MoveCategory.PHYSICAL && (user.status?.effect === StatusEffect.POISON || user.status?.effect === StatusEffect.TOXIC), 1.5),
    new Ability(Abilities.FLARE_BOOST, "Flare Boost", "Powers up special attacks when the Pokémon is burned.", 5)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.category === MoveCategory.SPECIAL && user.status?.effect === StatusEffect.BURN, 1.5),
    new Ability(Abilities.HARVEST, "Harvest (N)", "May create another Berry after one is used.", 5),
    new Ability(Abilities.TELEPATHY, "Telepathy (N)", "Anticipates an ally's attack and dodges it.", 5)
      .ignorable(),
    new Ability(Abilities.MOODY, "Moody", "Raises one stat sharply and lowers another every turn.", 5)
      .attr(PostTurnStatChangeAbAttr, BattleStat.RAND, 2)
      .attr(PostTurnStatChangeAbAttr, BattleStat.RAND, -1),
    new Ability(Abilities.OVERCOAT, "Overcoat", "Protects the Pokémon from things like sand, hail, and powder.", 5)
      .attr(BlockWeatherDamageAttr)
      .attr(MoveImmunityAbAttr, (pokemon, attacker, move) => pokemon !== attacker && move.getMove().hasFlag(MoveFlags.POWDER_MOVE))
      .ignorable(),
    new Ability(Abilities.POISON_TOUCH, "Poison Touch", "May poison a target when the Pokémon makes contact.", 5)
      .attr(PostAttackContactApplyStatusEffectAbAttr, 30, StatusEffect.POISON),
    new Ability(Abilities.REGENERATOR, "Regenerator", "Restores a little HP when withdrawn from battle.", 5)
    .attr(PreSwitchOutHealAbAttr),
    new Ability(Abilities.BIG_PECKS, "Big Pecks", "Protects the Pokémon from Defense-lowering effects.", 5)
      .attr(ProtectStatAbAttr, BattleStat.DEF)
      .ignorable(),
    new Ability(Abilities.SAND_RUSH, "Sand Rush", "Boosts the Pokémon's Speed stat in a sandstorm.", 5)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .attr(BlockWeatherDamageAttr, WeatherType.SANDSTORM)
      .condition(getWeatherCondition(WeatherType.SANDSTORM)),
    new Ability(Abilities.WONDER_SKIN, "Wonder Skin (N)", "Makes status moves more likely to miss.", 5)
      .ignorable(),
    new Ability(Abilities.ANALYTIC, "Analytic (N)", "Boosts move power when the Pokémon moves last.", 5),
    new Ability(Abilities.ILLUSION, "Illusion (N)", "Comes out disguised as the Pokémon in the party's last spot.", 5)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr),
    new Ability(Abilities.IMPOSTER, "Imposter", "The Pokémon transforms itself into the Pokémon it's facing.", 5)
      .attr(PostSummonTransformAbAttr)
      .attr(UncopiableAbilityAbAttr),
    new Ability(Abilities.INFILTRATOR, "Infiltrator (N)", "Passes through the opposing Pokémon's barrier, substitute, and the like and strikes.", 5),
    new Ability(Abilities.MUMMY, "Mummy", "Contact with the Pokémon changes the attacker's Ability to Mummy.", 5)
      .attr(PostDefendAbilityGiveAbAttr)
      .bypassFaint(),
    new Ability(Abilities.MOXIE, "Moxie", "The Pokémon shows moxie, and that boosts the Attack stat after knocking out any Pokémon.", 5)
      .attr(PostVictoryStatChangeAbAttr, BattleStat.ATK, 1),
    new Ability(Abilities.JUSTIFIED, "Justified", "Being hit by a Dark-type move boosts the Attack stat of the Pokémon, for justice.", 5)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.type === Type.DARK && move.category !== MoveCategory.STATUS, BattleStat.ATK, 1),
    new Ability(Abilities.RATTLED, "Rattled (P)", "Intimidate or being hit by a Dark-, Ghost-, or Bug-type move will scare the Pokémon and boost its Speed stat.", 5)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.category !== MoveCategory.STATUS && (move.type === Type.DARK || move.type === Type.BUG ||
        move.type === Type.GHOST), BattleStat.SPD, 1),
    new Ability(Abilities.MAGIC_BOUNCE, "Magic Bounce (N)", "Reflects status moves instead of getting hit by them.", 5)
      .ignorable(),
    new Ability(Abilities.SAP_SIPPER, "Sap Sipper", "Boosts the Attack stat if hit by a Grass-type move instead of taking damage.", 5)
      .attr(TypeImmunityStatChangeAbAttr, Type.GRASS, BattleStat.ATK, 1)
      .ignorable(),
    new Ability(Abilities.PRANKSTER, "Prankster", "Gives priority to a status move.", 5)
      .attr(IncrementMovePriorityAbAttr, (pokemon, move: Move) => move.category === MoveCategory.STATUS),
    new Ability(Abilities.SAND_FORCE, "Sand Force", "Boosts the power of Rock-, Ground-, and Steel-type moves in a sandstorm.", 5)
      .attr(MoveTypePowerBoostAbAttr, Type.ROCK, 1.3)
      .attr(MoveTypePowerBoostAbAttr, Type.GROUND, 1.3)
      .attr(MoveTypePowerBoostAbAttr, Type.STEEL, 1.3)
      .attr(BlockWeatherDamageAttr, WeatherType.SANDSTORM)
      .condition(getWeatherCondition(WeatherType.SANDSTORM)),
    new Ability(Abilities.IRON_BARBS, "Iron Barbs", "Inflicts damage on the attacker upon contact with iron barbs.", 5)
      .attr(PostDefendContactDamageAbAttr, 8)
      .bypassFaint(),
    new Ability(Abilities.ZEN_MODE, "Zen Mode", "Changes the Pokémon's shape when HP is half or less.", 5)
      .attr(PostBattleInitFormChangeAbAttr, p => p.getHpRatio() <= 0.5 ? 1 : 0)
      .attr(PostSummonFormChangeAbAttr, p => p.getHpRatio() <= 0.5 ? 1 : 0)
      .attr(PostTurnFormChangeAbAttr, p => p.getHpRatio() <= 0.5 ? 1 : 0)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.VICTORY_STAR, "Victory Star (P)", "Boosts the accuracy of its allies and itself.", 5)
      .attr(BattleStatMultiplierAbAttr, BattleStat.ACC, 1.1),
    new Ability(Abilities.TURBOBLAZE, "Turboblaze", "Moves can be used on the target regardless of its Abilities.", 5)
      .attr(PostSummonMessageAbAttr, (pokemon: Pokemon) => getPokemonMessage(pokemon, ' is radiating a blazing aura!'))
      .attr(MoveAbilityBypassAbAttr),
    new Ability(Abilities.TERAVOLT, "Teravolt", "Moves can be used on the target regardless of its Abilities.", 5)
      .attr(PostSummonMessageAbAttr, (pokemon: Pokemon) => getPokemonMessage(pokemon, ' is radiating a bursting aura!'))
      .attr(MoveAbilityBypassAbAttr),
    new Ability(Abilities.AROMA_VEIL, "Aroma Veil (N)", "Protects itself and its allies from attacks that limit their move choices.", 6)
      .ignorable(),
    new Ability(Abilities.FLOWER_VEIL, "Flower Veil (N)", "Ally Grass-type Pokémon are protected from status conditions and the lowering of their stats.", 6)
      .ignorable(),
    new Ability(Abilities.CHEEK_POUCH, "Cheek Pouch (N)", "Restores HP as well when the Pokémon eats a Berry.", 6),
    new Ability(Abilities.PROTEAN, "Protean (N)", "Changes the Pokémon's type to the type of the move it's about to use.", 6),
    new Ability(Abilities.FUR_COAT, "Fur Coat", "Halves the damage from physical moves.", 6)
      .attr(ReceivedMoveDamageMultiplierAbAttr, (target, user, move) => move.category === MoveCategory.PHYSICAL, 0.5)
      .ignorable(),
    new Ability(Abilities.MAGICIAN, "Magician", "The Pokémon steals the held item of a Pokémon it hits with a move.", 6)
      .attr(PostAttackStealHeldItemAbAttr),
    new Ability(Abilities.BULLETPROOF, "Bulletproof", "Protects the Pokémon from some ball and bomb moves.", 6)
      .attr(MoveImmunityAbAttr, (pokemon, attacker, move) => pokemon !== attacker && move.getMove().hasFlag(MoveFlags.BALLBOMB_MOVE))
      .ignorable(),
    new Ability(Abilities.COMPETITIVE, "Competitive", "Boosts the Sp. Atk stat sharply when a stat is lowered.", 6)
      .attr(PostStatChangeStatChangeAbAttr, (target, statsChanged, levels) => levels < 0, [BattleStat.SPATK], 2),
    new Ability(Abilities.STRONG_JAW, "Strong Jaw", "The Pokémon's strong jaw boosts the power of its biting moves.", 6)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.hasFlag(MoveFlags.BITING_MOVE), 1.5),
    new Ability(Abilities.REFRIGERATE, "Refrigerate", "Normal-type moves become Ice-type moves. The power of those moves is boosted a little.", 6)
      .attr(MoveTypeChangePowerMultiplierAbAttr, Type.NORMAL, Type.ICE, 1.2),
    new Ability(Abilities.SWEET_VEIL, "Sweet Veil (P)", "Prevents itself and ally Pokémon from falling asleep.", 6)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.SLEEP)
      .attr(BattlerTagImmunityAbAttr, BattlerTagType.DROWSY)
      .ignorable(),
    new Ability(Abilities.STANCE_CHANGE, "Stance Change", "The Pokémon changes its form to Blade Forme when it uses an attack move and changes to Shield Forme when it uses King's Shield.", 6)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.GALE_WINGS, "Gale Wings", "Gives priority to Flying-type moves when the Pokémon's HP is full.", 6)
      .attr(IncrementMovePriorityAbAttr, (pokemon, move) => pokemon.getHpRatio() === 1 && move.type === Type.FLYING),
    new Ability(Abilities.MEGA_LAUNCHER, "Mega Launcher", "Powers up aura and pulse moves.", 6)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.hasFlag(MoveFlags.PULSE_MOVE), 1.5),
    new Ability(Abilities.GRASS_PELT, "Grass Pelt", "Boosts the Pokémon's Defense stat on Grassy Terrain.", 6)
      .conditionalAttr(getTerrainCondition(TerrainType.GRASSY), BattleStatMultiplierAbAttr, BattleStat.DEF, 1.5)
      .ignorable(),
    new Ability(Abilities.SYMBIOSIS, "Symbiosis (N)", "The Pokémon passes its item to an ally that has used up an item.", 6),
    new Ability(Abilities.TOUGH_CLAWS, "Tough Claws", "Powers up moves that make direct contact.", 6)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), 1.3),
    new Ability(Abilities.PIXILATE, "Pixilate", "Normal-type moves become Fairy-type moves. The power of those moves is boosted a little.", 6)
      .attr(MoveTypeChangePowerMultiplierAbAttr, Type.NORMAL, Type.FAIRY, 1.2),
    new Ability(Abilities.GOOEY, "Gooey", "Contact with the Pokémon lowers the attacker's Speed stat.", 6)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), BattleStat.SPD, -1, false),
    new Ability(Abilities.AERILATE, "Aerilate", "Normal-type moves become Flying-type moves. The power of those moves is boosted a little.", 6)
      .attr(MoveTypeChangePowerMultiplierAbAttr, Type.NORMAL, Type.FLYING, 1.2),
    new Ability(Abilities.PARENTAL_BOND, "Parental Bond (N)", "Parent and child each attacks.", 6),
    new Ability(Abilities.DARK_AURA, "Dark Aura", "Powers up each Pokémon's Dark-type moves.", 6)
      .attr(PostSummonMessageAbAttr, (pokemon: Pokemon) => getPokemonMessage(pokemon, ' is radiating a Dark Aura!'))
      .attr(FieldMoveTypePowerBoostAbAttr, Type.DARK, 4 / 3),
    new Ability(Abilities.FAIRY_AURA, "Fairy Aura", "Powers up each Pokémon's Fairy-type moves.", 6)
      .attr(PostSummonMessageAbAttr, (pokemon: Pokemon) => getPokemonMessage(pokemon, ' is radiating a Fairy Aura!'))
      .attr(FieldMoveTypePowerBoostAbAttr, Type.FAIRY, 4 / 3),
    new Ability(Abilities.AURA_BREAK, "Aura Break (N)", "The effects of \"Aura\" Abilities are reversed to lower the power of affected moves.", 6)
      .ignorable(),
    new Ability(Abilities.PRIMORDIAL_SEA, "Primordial Sea", "The Pokémon changes the weather to nullify Fire-type attacks.", 6)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.HEAVY_RAIN)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.HEAVY_RAIN),
    new Ability(Abilities.DESOLATE_LAND, "Desolate Land", "The Pokémon changes the weather to nullify Water-type attacks.", 6)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.HARSH_SUN)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.HARSH_SUN),
    new Ability(Abilities.DELTA_STREAM, "Delta Stream", "The Pokémon changes the weather to eliminate all of the Flying type's weaknesses.", 6)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.STRONG_WINDS)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.STRONG_WINDS),
    new Ability(Abilities.STAMINA, "Stamina", "Boosts the Defense stat when hit by an attack.", 7)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.category !== MoveCategory.STATUS, BattleStat.DEF, 1),
    new Ability(Abilities.WIMP_OUT, "Wimp Out (N)", "The Pokémon cowardly switches out when its HP becomes half or less.", 7),
    new Ability(Abilities.EMERGENCY_EXIT, "Emergency Exit (N)", "The Pokémon, sensing danger, switches out when its HP becomes half or less.", 7),
    new Ability(Abilities.WATER_COMPACTION, "Water Compaction", "Boosts the Pokémon's Defense stat sharply when hit by a Water-type move.", 7)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.type === Type.WATER, BattleStat.DEF, 2),
    new Ability(Abilities.MERCILESS, "Merciless (N)", "The Pokémon's attacks become critical hits if the target is poisoned.", 7),
    new Ability(Abilities.SHIELDS_DOWN, "Shields Down (P)", "When its HP becomes half or less, the Pokémon's shell breaks and it becomes aggressive.", 7)
      .attr(PostBattleInitFormChangeAbAttr, p => p.formIndex % 7 + (p.getHpRatio() <= 0.5 ? 7 : 0))
      .attr(PostSummonFormChangeAbAttr, p => p.formIndex % 7 + (p.getHpRatio() <= 0.5 ? 7 : 0))
      .attr(PostTurnFormChangeAbAttr, p => p.formIndex % 7 + (p.getHpRatio() <= 0.5 ? 7 : 0))
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.STAKEOUT, "Stakeout (N)", "Doubles the damage dealt to the target's replacement if the target switches out.", 7),
    new Ability(Abilities.WATER_BUBBLE, "Water Bubble", "Lowers the power of Fire-type moves done to the Pokémon and prevents the Pokémon from getting a burn.", 7)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.FIRE, 0.5)
      .attr(MoveTypePowerBoostAbAttr, Type.WATER, 1)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.BURN)
      .ignorable(),
    new Ability(Abilities.STEELWORKER, "Steelworker", "Powers up Steel-type moves.", 7)
      .attr(MoveTypePowerBoostAbAttr, Type.STEEL),
    new Ability(Abilities.BERSERK, "Berserk (N)", "Boosts the Pokémon's Sp. Atk stat when it takes a hit that causes its HP to become half or less.", 7),
    new Ability(Abilities.SLUSH_RUSH, "Slush Rush", "Boosts the Pokémon's Speed stat in snow.", 7)
      .attr(BattleStatMultiplierAbAttr, BattleStat.SPD, 2)
      .condition(getWeatherCondition(WeatherType.HAIL, WeatherType.SNOW)),
    new Ability(Abilities.LONG_REACH, "Long Reach", "The Pokémon uses its moves without making contact with the target.", 7)
      .attr(IgnoreContactAbAttr),
    new Ability(Abilities.LIQUID_VOICE, "Liquid Voice", "All sound-based moves become Water-type moves.", 7)
      .attr(MoveTypeChangeAttr, Type.WATER, 1, (user, target, move) => move.hasFlag(MoveFlags.SOUND_BASED)),
    new Ability(Abilities.TRIAGE, "Triage", "Gives priority to a healing move.", 7)
      .attr(IncrementMovePriorityAbAttr, (pokemon, move) => move.hasFlag(MoveFlags.TRIAGE_MOVE), 3),
    new Ability(Abilities.GALVANIZE, "Galvanize", "Normal-type moves become Electric-type moves. The power of those moves is boosted a little.", 7)
      .attr(MoveTypeChangePowerMultiplierAbAttr, Type.NORMAL, Type.ELECTRIC, 1.2),
    new Ability(Abilities.SURGE_SURFER, "Surge Surfer", "Doubles the Pokémon's Speed stat on Electric Terrain.", 7)
      .conditionalAttr(getTerrainCondition(TerrainType.ELECTRIC), BattleStatMultiplierAbAttr, BattleStat.SPD, 2),
    new Ability(Abilities.SCHOOLING, "Schooling", "When it has a lot of HP, the Pokémon forms a powerful school. It stops schooling when its HP is low.", 7)
      .attr(PostBattleInitFormChangeAbAttr, p => p.level < 20 || p.getHpRatio() <= 0.25 ? 0 : 1)
      .attr(PostSummonFormChangeAbAttr, p => p.level < 20 || p.getHpRatio() <= 0.25 ? 0 : 1)
      .attr(PostTurnFormChangeAbAttr, p => p.level < 20 || p.getHpRatio() <= 0.25 ? 0 : 1)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.DISGUISE, "Disguise (P)", "Once per battle, the shroud that covers the Pokémon can protect it from an attack.", 7)
      .attr(PreDefendMovePowerToOneAbAttr, (target, user, move) => target.formIndex == 0 && target.getAttackTypeEffectiveness(move.type) > 0)
      .attr(PostSummonFormChangeAbAttr, p => p.battleData.hitCount === 0 ? 0 : 1)
      .attr(PostBattleInitFormChangeAbAttr, p => p.battleData.hitCount === 0 ? 0 : 1)
      .attr(PostDefendFormChangeAbAttr, p => p.battleData.hitCount === 0 ? 0 : 1)
      .attr(PreDefendFormChangeAbAttr, p => p.battleData.hitCount === 0 ? 0 : 1)
      .attr(PostDefendDisguiseAbAttr)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr)
      .ignorable(),
    new Ability(Abilities.BATTLE_BOND, "Battle Bond (N)", "Defeating an opposing Pokémon strengthens the Pokémon's bond with its Trainer, and it becomes Ash-Greninja. Water Shuriken gets more powerful.", 7)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.POWER_CONSTRUCT, "Power Construct (N)", "Other Cells gather to aid when its HP becomes half or less. Then the Pokémon changes its form to Complete Forme.", 7)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.CORROSION, "Corrosion (N)", "The Pokémon can poison the target even if it's a Steel or Poison type.", 7),
    new Ability(Abilities.COMATOSE, "Comatose (N)", "It's always drowsing and will never wake up. It can attack without waking up.", 7)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr),
    new Ability(Abilities.QUEENLY_MAJESTY, "Queenly Majesty", "Its majesty pressures the opposing Pokémon, making it unable to attack using priority moves.", 7)
      .attr(FieldPriorityMoveImmunityAbAttr)
      .ignorable(),
    new Ability(Abilities.INNARDS_OUT, "Innards Out (N)", "Damages the attacker landing the finishing hit by the amount equal to its last HP.", 7),
    new Ability(Abilities.DANCER, "Dancer (N)", "When another Pokémon uses a dance move, it can use a dance move following it regardless of its Speed.", 7),
    new Ability(Abilities.BATTERY, "Battery (N)", "Powers up ally Pokémon's special moves.", 7),
    new Ability(Abilities.FLUFFY, "Fluffy", "Halves the damage taken from moves that make direct contact, but doubles that of Fire-type moves.", 7)
      .attr(ReceivedMoveDamageMultiplierAbAttr, (target, user, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), 0.5)
      .attr(ReceivedMoveDamageMultiplierAbAttr, (target, user, move) => move.type === Type.FIRE, 2)
      .ignorable(),
    new Ability(Abilities.DAZZLING, "Dazzling", "Surprises the opposing Pokémon, making it unable to attack using priority moves.", 7)
      .attr(FieldPriorityMoveImmunityAbAttr)
      .ignorable(),
    new Ability(Abilities.SOUL_HEART, "Soul-Heart", "Boosts its Sp. Atk stat every time a Pokémon faints.", 7)
      .attr(PostKnockOutStatChangeAbAttr, BattleStat.SPATK, 1),
    new Ability(Abilities.TANGLING_HAIR, "Tangling Hair", "Contact with the Pokémon lowers the attacker's Speed stat.", 7)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), BattleStat.SPD, -1, false),
    new Ability(Abilities.RECEIVER, "Receiver", "The Pokémon copies the Ability of a defeated ally.", 7)
      .attr(CopyFaintedAllyAbilityAbAttr)
      .attr(UncopiableAbilityAbAttr),
    new Ability(Abilities.POWER_OF_ALCHEMY, "Power of Alchemy", "The Pokémon copies the Ability of a defeated ally.", 7)
      .attr(CopyFaintedAllyAbilityAbAttr)
      .attr(UncopiableAbilityAbAttr),
    new Ability(Abilities.BEAST_BOOST, "Beast Boost", "The Pokémon boosts its most proficient stat each time it knocks out a Pokémon.", 7)
      .attr(PostVictoryStatChangeAbAttr, p => {
        const battleStats = Utils.getEnumValues(BattleStat).slice(0, -3).map(s => s as BattleStat);
        let highestBattleStat = 0;
        let highestBattleStatIndex = 0;
        battleStats.map((bs: BattleStat, i: integer) => {
          const stat = p.getStat(bs + 1);
          if (stat > highestBattleStat) {
            highestBattleStatIndex = i;
            highestBattleStat = stat;
          }
        });
        return highestBattleStatIndex;
      }, 1),
    new Ability(Abilities.RKS_SYSTEM, "RKS System (N)", "Changes the Pokémon's type to match the memory disc it holds.", 7)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.ELECTRIC_SURGE, "Electric Surge", "Turns the ground into Electric Terrain when the Pokémon enters a battle.", 7)
      .attr(PostSummonTerrainChangeAbAttr, TerrainType.ELECTRIC)
      .attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.ELECTRIC),
    new Ability(Abilities.PSYCHIC_SURGE, "Psychic Surge", "Turns the ground into Psychic Terrain when the Pokémon enters a battle.", 7)
      .attr(PostSummonTerrainChangeAbAttr, TerrainType.PSYCHIC)
      .attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.PSYCHIC),
    new Ability(Abilities.MISTY_SURGE, "Misty Surge", "Turns the ground into Misty Terrain when the Pokémon enters a battle.", 7)
      .attr(PostSummonTerrainChangeAbAttr, TerrainType.MISTY)
      .attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.MISTY),
    new Ability(Abilities.GRASSY_SURGE, "Grassy Surge", "Turns the ground into Grassy Terrain when the Pokémon enters a battle.", 7)
      .attr(PostSummonTerrainChangeAbAttr, TerrainType.GRASSY)
      .attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.GRASSY),
    new Ability(Abilities.FULL_METAL_BODY, "Full Metal Body", "Prevents other Pokémon's moves or Abilities from lowering the Pokémon's stats.", 7)
      .attr(ProtectStatAbAttr),
    new Ability(Abilities.SHADOW_SHIELD, "Shadow Shield", "Reduces the amount of damage the Pokémon takes while its HP is full.", 7)
      .attr(ReceivedMoveDamageMultiplierAbAttr,(target, user, move) => target.getHpRatio() === 1, 0.5),
    new Ability(Abilities.PRISM_ARMOR, "Prism Armor", "Reduces the power of supereffective attacks taken.", 7)
      .attr(ReceivedMoveDamageMultiplierAbAttr,(target, user, move) => target.getAttackTypeEffectiveness(move.type) >= 2, 0.75),
    new Ability(Abilities.NEUROFORCE, "Neuroforce", "Powers up moves that are super effective.", 7)
      .attr(MovePowerBoostAbAttr, (user, target, move) => target.getAttackTypeEffectiveness(move.type) >= 2, 1.25),
    new Ability(Abilities.INTREPID_SWORD, "Intrepid Sword", "Boosts the Pokémon's Attack stat when the Pokémon enters a battle.", 8)
      .attr(PostSummonStatChangeAbAttr, BattleStat.ATK, 1, true),
    new Ability(Abilities.DAUNTLESS_SHIELD, "Dauntless Shield", "Boosts the Pokémon's Defense stat when the Pokémon enters a battle.", 8)
      .attr(PostSummonStatChangeAbAttr, BattleStat.DEF, 1, true),
    new Ability(Abilities.LIBERO, "Libero (N)", "Changes the Pokémon's type to the type of the move it's about to use.", 8),
    new Ability(Abilities.BALL_FETCH, "Ball Fetch (N)", "The Pokémon will fetch the Poké Ball from the first failed throw of the battle.", 8),
    new Ability(Abilities.COTTON_DOWN, "Cotton Down (N)", "When the Pokémon is hit by an attack, it scatters cotton fluff around and lowers the Speed stat of all Pokémon except itself.", 8),
    new Ability(Abilities.PROPELLER_TAIL, "Propeller Tail (N)", "Ignores the effects of opposing Pokémon's Abilities and moves that draw in moves.", 8),
    new Ability(Abilities.MIRROR_ARMOR, "Mirror Armor (N)", "Bounces back only the stat-lowering effects that the Pokémon receives.", 8)
      .ignorable(),
    new Ability(Abilities.GULP_MISSILE, "Gulp Missile (N)", "When the Pokémon uses Surf or Dive, it will come back with prey. When it takes damage, it will spit out the prey to attack.", 8)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.STALWART, "Stalwart (N)", "Ignores the effects of opposing Pokémon's Abilities and moves that draw in moves.", 8),
    new Ability(Abilities.STEAM_ENGINE, "Steam Engine", "Boosts the Pokémon's Speed stat drastically if hit by a Fire- or Water-type move.", 8)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.type === Type.FIRE || move.type === Type.WATER, BattleStat.SPD, 6),
    new Ability(Abilities.PUNK_ROCK, "Punk Rock", "Boosts the power of sound-based moves. The Pokémon also takes half the damage from these kinds of moves.", 8)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.hasFlag(MoveFlags.SOUND_BASED), 1.3)
      .attr(ReceivedMoveDamageMultiplierAbAttr, (target, user, move) => move.hasFlag(MoveFlags.SOUND_BASED), 0.5)
      .ignorable(),
    new Ability(Abilities.SAND_SPIT, "Sand Spit", "The Pokémon creates a sandstorm when it's hit by an attack.", 8)
      .attr(PostDefendWeatherChangeAbAttr, WeatherType.SANDSTORM),
    new Ability(Abilities.ICE_SCALES, "Ice Scales", "The Pokémon is protected by ice scales, which halve the damage taken from special moves.", 8)
      .attr(ReceivedMoveDamageMultiplierAbAttr, (target, user, move) => move.category === MoveCategory.SPECIAL, 0.5)
      .ignorable(),
    new Ability(Abilities.RIPEN, "Ripen", "Ripens Berries and doubles their effect.", 8)
      .attr(DoubleBerryEffectAbAttr),
    new Ability(Abilities.ICE_FACE, "Ice Face (N)", "The Pokémon's ice head can take a physical attack as a substitute, but the attack also changes the Pokémon's appearance. The ice will be restored when it hails.", 8)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr)
      .ignorable(),
    new Ability(Abilities.POWER_SPOT, "Power Spot (N)", "Just being next to the Pokémon powers up moves.", 8),
    new Ability(Abilities.MIMICRY, "Mimicry (N)", "Changes the Pokémon's type depending on the terrain.", 8),
    new Ability(Abilities.SCREEN_CLEANER, "Screen Cleaner (N)", "When the Pokémon enters a battle, the effects of Light Screen, Reflect, and Aurora Veil are nullified for both opposing and ally Pokémon.", 8),
    new Ability(Abilities.STEELY_SPIRIT, "Steely Spirit (N)", "Powers up ally Pokémon's Steel-type moves.", 8),
    new Ability(Abilities.PERISH_BODY, "Perish Body (N)", "When hit by a move that makes direct contact, the Pokémon and the attacker will faint after three turns unless they switch out of battle.", 8),
    new Ability(Abilities.WANDERING_SPIRIT, "Wandering Spirit (P)", "The Pokémon exchanges Abilities with a Pokémon that hits it with a move that makes direct contact.", 8)
      .attr(PostDefendAbilitySwapAbAttr)
      .bypassFaint(),
    new Ability(Abilities.GORILLA_TACTICS, "Gorilla Tactics (N)", "Boosts the Pokémon's Attack stat but only allows the use of the first selected move.", 8),
    new Ability(Abilities.NEUTRALIZING_GAS, "Neutralizing Gas (P)", "If the Pokémon with Neutralizing Gas is in the battle, the effects of all Pokémon's Abilities will be nullified or will not be triggered.", 8)
      .attr(SuppressFieldAbilitiesAbAttr)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.PASTEL_VEIL, "Pastel Veil", "Protects the Pokémon and its ally Pokémon from being poisoned.", 8)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.POISON, StatusEffect.TOXIC)
      .ignorable(),
    new Ability(Abilities.HUNGER_SWITCH, "Hunger Switch", "The Pokémon changes its form, alternating between its Full Belly Mode and Hangry Mode after the end of each turn.", 8)
      .attr(PostTurnFormChangeAbAttr, p => p.getFormKey ? 0 : 1)
      .attr(PostTurnFormChangeAbAttr, p => p.getFormKey ? 1 : 0)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.QUICK_DRAW, "Quick Draw (N)", "Enables the Pokémon to move first occasionally.", 8),
    new Ability(Abilities.UNSEEN_FIST, "Unseen Fist (N)", "If the Pokémon uses moves that make direct contact, it can attack the target even if the target protects itself.", 8),
    new Ability(Abilities.CURIOUS_MEDICINE, "Curious Medicine (N)", "When the Pokémon enters a battle, it scatters medicine from its shell, which removes all stat changes from allies.", 8),
    new Ability(Abilities.TRANSISTOR, "Transistor", "Powers up Electric-type moves.", 8)
      .attr(MoveTypePowerBoostAbAttr, Type.ELECTRIC),
    new Ability(Abilities.DRAGONS_MAW, "Dragon's Maw", "Powers up Dragon-type moves.", 8)
      .attr(MoveTypePowerBoostAbAttr, Type.DRAGON),
    new Ability(Abilities.CHILLING_NEIGH, "Chilling Neigh", "When the Pokémon knocks out a target, it utters a chilling neigh, which boosts its Attack stat.", 8)
      .attr(PostVictoryStatChangeAbAttr, BattleStat.ATK, 1),
    new Ability(Abilities.GRIM_NEIGH, "Grim Neigh", "When the Pokémon knocks out a target, it utters a terrifying neigh, which boosts its Sp. Atk stat.", 8)
      .attr(PostVictoryStatChangeAbAttr, BattleStat.SPATK, 1),
    new Ability(Abilities.AS_ONE_GLASTRIER, "As One", "This Ability combines the effects of both Calyrex's Unnerve Ability and Glastrier's Chilling Neigh Ability.", 8)
      .attr(PreventBerryUseAbAttr)
      .attr(PostVictoryStatChangeAbAttr, BattleStat.ATK, 1)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr),
    new Ability(Abilities.AS_ONE_SPECTRIER, "As One", "This Ability combines the effects of both Calyrex's Unnerve Ability and Spectrier's Grim Neigh Ability.", 8)
      .attr(PreventBerryUseAbAttr)
      .attr(PostVictoryStatChangeAbAttr, BattleStat.SPATK, 1)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr),
    new Ability(Abilities.LINGERING_AROMA, "Lingering Aroma", "Contact with the Pokémon changes the attacker's Ability to Lingering Aroma.", 9)
      .attr(PostDefendAbilityGiveAbAttr)
      .bypassFaint(),
    new Ability(Abilities.SEED_SOWER, "Seed Sower", "Turns the ground into Grassy Terrain when the Pokémon is hit by an attack.", 9)
      .attr(PostDefendTerrainChangeAbAttr, TerrainType.GRASSY),
    new Ability(Abilities.THERMAL_EXCHANGE, "Thermal Exchange", "Boosts the Attack stat when the Pokémon is hit by a Fire-type move. The Pokémon also cannot be burned.", 9)
      .attr(PostDefendStatChangeAbAttr, (target, user, move) => move.type === Type.FIRE && move.category !== MoveCategory.STATUS, BattleStat.ATK, 1)
      .attr(StatusEffectImmunityAbAttr, StatusEffect.BURN)
      .ignorable(),
    new Ability(Abilities.ANGER_SHELL, "Anger Shell (N)", "When an attack causes its HP to drop to half or less, the Pokémon gets angry. This lowers its Defense and Sp. Def stats but boosts its Attack, Sp. Atk, and Speed stats.", 9),
    new Ability(Abilities.PURIFYING_SALT, "Purifying Salt", "The Pokémon's pure salt protects it from status conditions and halves the damage taken from Ghost-type moves.", 9)
      .attr(StatusEffectImmunityAbAttr)
      .attr(ReceivedTypeDamageMultiplierAbAttr, Type.GHOST, 0.5)
      .ignorable(),
    new Ability(Abilities.WELL_BAKED_BODY, "Well-Baked Body", "The Pokémon takes no damage when hit by Fire-type moves. Instead, its Defense stat is sharply boosted.", 9)
      .attr(TypeImmunityStatChangeAbAttr, Type.FIRE, BattleStat.DEF, 2)
      .ignorable(),
    new Ability(Abilities.WIND_RIDER, "Wind Rider (P)", "Boosts the Pokémon's Attack stat if Tailwind takes effect or if the Pokémon is hit by a wind move. The Pokémon also takes no damage from wind moves.", 9)
      .attr(MoveImmunityStatChangeAbAttr, (pokemon, attacker, move) => pokemon !== attacker && move.getMove().hasFlag(MoveFlags.WIND_MOVE), BattleStat.ATK, 1)
      .ignorable(),
    new Ability(Abilities.GUARD_DOG, "Guard Dog (N)", "Boosts the Pokémon's Attack stat if intimidated. Moves and items that would force the Pokémon to switch out also fail to work.", 9)
      .ignorable(),
    new Ability(Abilities.ROCKY_PAYLOAD, "Rocky Payload", "Powers up Rock-type moves.", 9)
      .attr(MoveTypePowerBoostAbAttr, Type.ROCK),
    new Ability(Abilities.WIND_POWER, "Wind Power (P)", "The Pokémon becomes charged when it is hit by a wind move, boosting the power of the next Electric-type move the Pokémon uses.", 9)
      .attr(PostDefendApplyBattlerTagAbAttr, (target, user, move) => move.hasFlag(MoveFlags.WIND_MOVE), BattlerTagType.CHARGED),
    new Ability(Abilities.ZERO_TO_HERO, "Zero to Hero (N)", "The Pokémon transforms into its Hero Form when it switches out.", 9)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.COMMANDER, "Commander (N)", "When the Pokémon enters a battle, it goes inside the mouth of an ally Dondozo if one is on the field. The Pokémon then issues commands from there.", 9)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr),
    new Ability(Abilities.ELECTROMORPHOSIS, "Electromorphosis", "The Pokémon becomes charged when it takes damage, boosting the power of the next Electric-type move the Pokémon uses.", 9)
      .attr(PostDefendApplyBattlerTagAbAttr, (target, user, move) => move.category !== MoveCategory.STATUS, BattlerTagType.CHARGED),
    new Ability(Abilities.PROTOSYNTHESIS, "Protosynthesis", "Boosts the Pokémon's most proficient stat in harsh sunlight or if the Pokémon is holding Booster Energy.", 9)
      .conditionalAttr(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN), PostSummonAddBattlerTagAbAttr, BattlerTagType.PROTOSYNTHESIS, 0, true)
      .attr(PostWeatherChangeAddBattlerTagAttr, BattlerTagType.PROTOSYNTHESIS, 0, WeatherType.SUNNY, WeatherType.HARSH_SUN)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.QUARK_DRIVE, "Quark Drive", "Boosts the Pokémon's most proficient stat on Electric Terrain or if the Pokémon is holding Booster Energy.", 9)
      .conditionalAttr(getTerrainCondition(TerrainType.ELECTRIC), PostSummonAddBattlerTagAbAttr, BattlerTagType.QUARK_DRIVE, 0, true)
      .attr(PostTerrainChangeAddBattlerTagAttr, BattlerTagType.QUARK_DRIVE, 0, TerrainType.ELECTRIC)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.GOOD_AS_GOLD, "Good as Gold (P)", "A body of pure, solid gold gives the Pokémon full immunity to other Pokémon's status moves.", 9)
      .attr(MoveImmunityAbAttr, (pokemon, attacker, move) => pokemon !== attacker && move.getMove().category === MoveCategory.STATUS)
      .ignorable(),
    new Ability(Abilities.VESSEL_OF_RUIN, "Vessel of Ruin (N)", "The power of the Pokémon's ruinous vessel lowers the Sp. Atk stats of all Pokémon except itself.", 9)
      .ignorable(),
    new Ability(Abilities.SWORD_OF_RUIN, "Sword of Ruin (N)", "The power of the Pokémon's ruinous sword lowers the Defense stats of all Pokémon except itself.", 9)
      .ignorable(),
    new Ability(Abilities.TABLETS_OF_RUIN, "Tablets of Ruin (N)", "The power of the Pokémon's ruinous wooden tablets lowers the Attack stats of all Pokémon except itself.", 9)
      .ignorable(),
    new Ability(Abilities.BEADS_OF_RUIN, "Beads of Ruin (N)", "The power of the Pokémon's ruinous beads lowers the Sp. Def stats of all Pokémon except itself.", 9)
      .ignorable(),
    new Ability(Abilities.ORICHALCUM_PULSE, "Orichalcum Pulse", "Turns the sunlight harsh when the Pokémon enters a battle. The ancient pulse thrumming through the Pokémon also boosts its Attack stat in harsh sunlight.", 9)
      .attr(PostSummonWeatherChangeAbAttr, WeatherType.SUNNY)
      .attr(PostBiomeChangeWeatherChangeAbAttr, WeatherType.SUNNY)
      .conditionalAttr(getWeatherCondition(WeatherType.SUNNY, WeatherType.HARSH_SUN), BattleStatMultiplierAbAttr, BattleStat.ATK, 4 / 3),
    new Ability(Abilities.HADRON_ENGINE, "Hadron Engine", "Turns the ground into Electric Terrain when the Pokémon enters a battle. The futuristic engine within the Pokémon also boosts its Sp. Atk stat on Electric Terrain.", 9)
      .attr(PostSummonTerrainChangeAbAttr, TerrainType.ELECTRIC)
      .attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.ELECTRIC)
      .conditionalAttr(getTerrainCondition(TerrainType.ELECTRIC), BattleStatMultiplierAbAttr, BattleStat.SPATK, 4 / 3),
    new Ability(Abilities.OPPORTUNIST, "Opportunist (N)", "If an opponent's stat is boosted, the Pokémon seizes the opportunity to boost the same stat for itself.", 9),
    new Ability(Abilities.CUD_CHEW, "Cud Chew (N)", "When the Pokémon eats a Berry, it will regurgitate that Berry at the end of the next turn and eat it one more time.", 9),
    new Ability(Abilities.SHARPNESS, "Sharpness", "Powers up slicing moves.", 9)
      .attr(MovePowerBoostAbAttr, (user, target, move) => move.hasFlag(MoveFlags.SLICING_MOVE), 1.5),
    new Ability(Abilities.SUPREME_OVERLORD, "Supreme Overlord (N)", "When the Pokémon enters a battle, its Attack and Sp. Atk stats are slightly boosted for each of the allies in its party that have already been defeated.", 9),
    new Ability(Abilities.COSTAR, "Costar (N)", "When the Pokémon enters a battle, it copies an ally's stat changes.", 9),
    new Ability(Abilities.TOXIC_DEBRIS, "Toxic Debris (N)", "Scatters poison spikes at the feet of the opposing team when the Pokémon takes damage from physical moves.", 9),
    new Ability(Abilities.ARMOR_TAIL, "Armor Tail", "The mysterious tail covering the Pokémon's head makes opponents unable to use priority moves against the Pokémon or its allies.", 9)
      .attr(FieldPriorityMoveImmunityAbAttr)  
      .ignorable(),
    new Ability(Abilities.EARTH_EATER, "Earth Eater", "If hit by a Ground-type move, the Pokémon has its HP restored instead of taking damage.", 9)
      .attr(TypeImmunityHealAbAttr, Type.GROUND)
      .ignorable(),
    new Ability(Abilities.MYCELIUM_MIGHT, "Mycelium Might (P)", "The Pokémon will always act more slowly when using status moves, but these moves will be unimpeded by the Ability of the target.", 9)
      .attr(MoveAbilityBypassAbAttr, (pokemon, move: Move) => move.category === MoveCategory.STATUS),
    new Ability(Abilities.MINDS_EYE, "Mind's Eye (N)", "The Pokémon ignores changes to opponents' evasiveness, its accuracy can't be lowered, and it can hit Ghost types with Normal- and Fighting-type moves.", 9)
      .ignorable(),
    new Ability(Abilities.SUPERSWEET_SYRUP, "Supersweet Syrup (N)", "A sickly sweet scent spreads across the field the first time the Pokémon enters a battle, lowering the evasiveness of opposing Pokémon.", 9),
    new Ability(Abilities.HOSPITALITY, "Hospitality (N)", "When the Pokémon enters a battle, it showers its ally with hospitality, restoring a small amount of the ally's HP.", 9),
    new Ability(Abilities.TOXIC_CHAIN, "Toxic Chain", "The power of the Pokémon's toxic chain may badly poison any target the Pokémon hits with a move.", 9)
      .attr(PostAttackApplyStatusEffectAbAttr, false, 30, StatusEffect.TOXIC),
    new Ability(Abilities.EMBODY_ASPECT_TEAL, "Embody Aspect", "The Pokémon's heart fills with memories, causing the Teal Mask to shine and the Pokémon's Speed stat to be boosted.", 9)
      .attr(PostBattleInitStatChangeAbAttr, BattleStat.SPD, 1, true)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.EMBODY_ASPECT_WELLSPRING, "Embody Aspect", "The Pokémon's heart fills with memories, causing the Wellspring Mask to shine and the Pokémon's Sp. Def stat to be boosted.", 9)
      .attr(PostBattleInitStatChangeAbAttr, BattleStat.SPDEF, 1, true)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.EMBODY_ASPECT_HEARTHFLAME, "Embody Aspect", "The Pokémon's heart fills with memories, causing the Hearthflame Mask to shine and the Pokémon's Attack stat to be boosted.", 9)
      .attr(PostBattleInitStatChangeAbAttr, BattleStat.ATK, 1, true)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.EMBODY_ASPECT_CORNERSTONE, "Embody Aspect", "The Pokémon's heart fills with memories, causing the Cornerstone Mask to shine and the Pokémon's Defense stat to be boosted.", 9)
      .attr(PostBattleInitStatChangeAbAttr, BattleStat.DEF, 1, true)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr),
    new Ability(Abilities.TERA_SHIFT, "Tera Shift", "When the Pokémon enters a battle, it absorbs the energy around itself and transforms into its Terastal Form.", 9)
      .attr(PostSummonFormChangeAbAttr, p => p.getFormKey() ? 0 : 1)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .attr(UnsuppressableAbilityAbAttr)
      .attr(NoTransformAbilityAbAttr)
      .attr(NoFusionAbilityAbAttr),
    new Ability(Abilities.TERA_SHELL, "Tera Shell (N)", "The Pokémon's shell contains the powers of each type. All damage-dealing moves that hit the Pokémon when its HP is full will not be very effective.", 9)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
      .ignorable(),
    new Ability(Abilities.TERAFORM_ZERO, "Teraform Zero (N)", "When Terapagos changes into its Stellar Form, it uses its hidden powers to eliminate all effects of weather and terrain, reducing them to zero.", 9)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr),
    new Ability(Abilities.POISON_PUPPETEER, "Poison Puppeteer (N)", "Pokémon poisoned by Pecharunt's moves will also become confused.", 9)
      .attr(UncopiableAbilityAbAttr)
      .attr(UnswappableAbilityAbAttr)
  );
}

/**
 * Les pseudos d'emprunt d'un compte supprimé.
 *
 * Supprimer un compte qui a joué ne l'efface pas : ses matchs, son palmarès et
 * le bilan de ses équipes se lisent sur des lignes qui le référencent. Sa ligne
 * reste donc, **sous un faux nom** — c'est le droit à l'oubli tel qu'un
 * historique partagé le permet : les statistiques demeurent, plus rien ne
 * remonte à la personne.
 *
 * Le faux nom est tiré de cette liste plutôt que fabriqué (`compte_supprime_412`
 * portait l'identifiant du compte, et se lisait comme une erreur dans un
 * plateau). Il se lit comme un pseudo ordinaire : c'est la **fiche** du joueur
 * et sa carte d'annuaire qui disent que le compte est supprimé, jamais le nom
 * lui-même, qu'un bracket affiche sans contexte.
 *
 * Module **pur** : le tirage prend son aléa en argument.
 */

/** Les mille pseudos d'emprunt, dans l'ordre de la liste d'origine. */
export const ANONYMOUS_PSEUDOS: readonly string[] = [
  "AlphaFX", "AlphaFury", "AlphaGod", "AlphaOne", "AlphaPRO", "AlphaReaperFX",
  "AlphaWarlord", "AlphaXL", "AlphaZero", "Alpha_Blade149", "Alpha_Nova753", "Alpha_Ranger",
  "Alpha_Yeti", "Alphax", "Apex99", "ApexBaron", "ApexDragon", "ApexEagleGod",
  "ApexOverlord", "ApexPRO", "ApexTV", "ApexZero", "Apex_Eagle", "Apex_Yeti",
  "AsassinMaster3903", "AsassinMaster6061", "AstroBladePrime", "AstroKnightZero", "AstroMaverickTTV", "AstroMode",
  "AstroPulse007", "AstroSentinelMode", "AstroSniperx", "AstroTitanGod", "AstroXL", "AstroXenoZone",
  "AstroZero", "Astro_Cobra", "Atomic99", "AtomicDemonOne", "AtomicHawkFX", "AtomicMaverickTTV",
  "AtomicTrooper", "AtomicXL", "Atomic_Asassin480", "Atomic_Cobra253", "Atomic_Demon946", "Atomic_Phantom511",
  "BaronMaster2383", "BaronMaster8887", "BeastMaster7297", "BladeMaster2394", "Blaze007", "BlazeEagle",
  "BlazeFury", "BlazeMaverickZero", "BlazePulse", "BlazeWarlord", "BlazeXeno", "BlazeZero",
  "Blaze_Juggernaut49", "Blaze_Ninja727", "Blaze_Reaper", "Blaze_Trooper851", "Blaze_Viper714", "BlitzAsassin",
  "BlitzSpectre", "BlitzStriker", "BlitzWarlockZone", "Blitz_Eagle", "Blitz_Kraken", "Blitz_Nomad653",
  "Blitz_Phoenix", "Blitz_Sniper", "Blitz_Vanguard", "Blitzx", "BluntRanger", "BluntVanguardx",
  "BluntViperFX", "BluntZero", "Blunt_Warlord", "Blunt_Warrior472", "CaptainAlpha", "CaptainApex",
  "CaptainAstro", "CaptainAtomic", "CaptainBlaze", "CaptainBlitz", "CaptainBlunt", "CaptainChaos",
  "CaptainCyber", "CaptainDark", "CaptainDread", "CaptainEcho", "CaptainEmber", "CaptainFrost",
  "CaptainGiga", "CaptainHavok", "CaptainHyper", "CaptainInferno", "CaptainJade", "CaptainKrypton",
  "CaptainLunar", "CaptainMystic", "CaptainNeon", "CaptainNexus", "CaptainNova", "CaptainOmega",
  "CaptainPhantom", "CaptainPixel", "CaptainPsycho", "CaptainQuantum", "CaptainRage", "CaptainRogue",
  "CaptainShadow", "CaptainStorm", "CaptainToxic", "CaptainValiant", "CaptainVenom", "CaptainXenon",
  "CaptainZephyr", "ChaosGuardianOne", "ChaosHunter007", "ChaosQuasar", "ChaosShadow007", "ChaosSpectre",
  "ChaosYeti99", "Chaos_Warlock", "Chaos_Warrior", "CobraMaster2797", "CobraMaster3171", "CobraMaster6020",
  "CobraMaster6525", "CrimsonHD", "CrimsonOverlord", "CrimsonPulseTV", "CrimsonTV", "CrimsonTitanZero",
  "CrimsonXL", "Crimson_Blade434", "Crimson_Demon910", "Crimson_Hawk778", "Crimson_Warlock230", "Crimson_Xeno",
  "CyberEagleTV", "CyberFury", "CyberOrcaPRO", "CyberRangerTTV", "Cyber_Legend25", "Cyber_Nova",
  "Cyber_Trooper", "DarkFX", "DarkQuasar", "DarkTrooper", "Dark_Demon436", "Dark_Fury",
  "Dark_Knight", "Dark_Predator", "DemonMaster8771", "Dr_Asassin", "Dr_Beast", "Dr_Blade",
  "Dr_Cobra", "Dr_Demon", "Dr_Dragon", "Dr_Eagle", "Dr_Fury", "Dr_Guardian",
  "Dr_Hawk", "Dr_Hunter", "Dr_Impuls", "Dr_Juggernaut", "Dr_Knight", "Dr_Kraken",
  "Dr_Legend", "Dr_Maverick", "Dr_Ninja", "Dr_Nomad", "Dr_Nova", "Dr_Orca",
  "Dr_Overlord", "Dr_Phoenix", "Dr_Predator", "Dr_Pulse", "Dr_Quasar", "Dr_Ranger",
  "Dr_Raven", "Dr_Reaper", "Dr_Samurai", "Dr_Sentinel", "Dr_Shadow", "Dr_Slayer",
  "Dr_Sniper", "Dr_Spectre", "Dr_Titan", "Dr_Trooper", "Dr_Vanguard", "Dr_Viper",
  "Dr_Warlock", "Dr_Warlord", "Dr_Warrior", "Dr_Xeno", "Dr_Zealot", "DragonMaster1902",
  "DreadBaron", "DreadOverlord", "DreadSlayerMode", "DreadXL", "DreadZone", "Dread_Eagle",
  "Dread_Fury", "Dread_Guardian", "Dread_Hawk670", "Dread_Juggernaut891", "Dread_Knight666", "EagleMaster8787",
  "EchoGhostZero", "EchoHawk", "EchoPrime", "EchoSamurai", "EchoSpectre007", "EchoStriker",
  "EchoTV", "EchoYetiTTV", "EchoZero", "Echo_Beast206", "Echo_Juggernaut", "Echox",
  "EmberNova", "EmberNovaXL", "EmberStrikerGod", "EmberZealot", "Ember_Slayer", "Ember_Warrior467",
  "FluxAsassinTTV", "FluxDemon", "FluxFalcon", "FluxPRO", "FluxQuasar", "FluxSlayerPRO",
  "FluxSniperHD", "FluxStriker", "Flux_Demon952", "Flux_Knight955", "Flux_Ninja", "Flux_Reaper",
  "Flux_Warlord", "Flux_Warrior55", "FrostBaron", "FrostBeast", "FrostFury99", "FrostMaverickFX",
  "FrostMode", "FrostTrooper", "FrostXL", "FrostZero", "Frost_Asassin", "Frost_Nomad428",
  "Frost_Overlord", "Frost_Slayer", "Frost_Titan842", "FuryMaster3965", "FuryMaster525", "GhostMaster1284",
  "GigaBaron", "GigaDragon", "GigaGuardianTV", "GigaKnightTTV", "GigaMode", "GigaRavenx",
  "GigaTitan", "GigaVanguardPrime", "GigaZone", "Giga_Falcon", "Giga_Kraken", "Giga_Predator566",
  "Gigax", "GuardianMaster3052", "HavokBladeXL", "HavokCobra007", "HavokGuardianHD", "HavokHunter",
  "HavokPhantomXL", "HavokPhoenixZero", "HavokXL", "Havok_Nova", "Havok_Orca805", "Havok_Sniper",
  "Havok_Sniper813", "Havok_Xeno991", "HawkMaster2900", "HawkMaster3154", "HawkMaster5313", "HawkMaster649",
  "HawkMaster9440", "HunterMaster2837", "HunterMaster3627", "HunterMaster6295", "HunterMaster8404", "HunterMaster8784",
  "Hyper_Eagle541", "Hyper_Knight", "Hyper_Maverick", "Hyper_Predator848", "Hyper_Ranger", "Hyper_Warlock593",
  "Hyper_Warlock94", "Hyper_Zealot435", "ImpulsMaster4146", "ImpulsMaster4367", "ImpulsMaster6391", "ImpulsMaster823",
  "InfernoFX", "InfernoHD", "InfernoLegendTV", "InfernoTV", "Inferno_Eagle", "Inferno_Orca425",
  "Inferno_Pulse", "Inferno_Reaper826", "Inferno_Sniper", "Inferno_Striker", "Inferno_Warrior", "Infernox",
  "IronBaron", "IronBlade", "IronNinjaFX", "IronOverlord", "IronPrime", "IronRanger",
  "Iron_Dragon", "Iron_Pulse", "Iron_Trooper575", "Iron_Warlock732", "Ironx", "JadeFury",
  "JadeOne", "JadeOverlord", "JadePRO", "JadeRavenFX", "JadeSpectre", "JadeZone",
  "Jade_Eagle", "Jade_Hunter183", "Jade_Viper", "Jade_Xeno694", "JuggernautMaster386", "JuggernautMaster9113",
  "KnightMaster3499", "KnightMaster7796", "KrakenMaster9006", "KryptonFury007", "KryptonShadow", "Krypton_Eagle",
  "Krypton_Hunter308", "Krypton_Legend", "LethalDemon", "LethalDemonTV", "LethalGhostZero", "LethalGuardianOne",
  "LethalSpectre", "Lethal_Asassin604", "Lethal_Beast541", "Lethal_Impuls", "Lethalx", "LordAsassin",
  "LordBaron", "LordBeast", "LordBlade", "LordCobra", "LordDemon", "LordDragon",
  "LordEagle", "LordFalcon", "LordFury", "LordGhost", "LordGuardian", "LordHawk",
  "LordHunter", "LordImpuls", "LordKnight", "LordKraken", "LordLegend", "LordMaverick",
  "LordNinja", "LordNomad", "LordNova", "LordOrca", "LordOverlord", "LordPhantom",
  "LordPhoenix", "LordPredator", "LordPulse", "LordQuasar", "LordRaven", "LordSamurai",
  "LordSentinel", "LordShadow", "LordSlayer", "LordSniper", "LordSpectre", "LordTitan",
  "LordTrooper", "LordVanguard", "LordViper", "LordWarlock", "LordWarlord", "LordWarrior",
  "LordXeno", "LunarGhost", "LunarSamurai", "LunarShadowXL", "LunarSlayer", "LunarTitanTTV",
  "LunarViper", "LunarXenoPrime", "Lunar_Beast886", "Lunar_Juggernaut", "Lunar_Maverick", "Lunar_Reaper948",
  "Lunarx", "MaverickMaster3206", "MaverickMaster7", "Mystic99", "MysticEagle", "MysticMode",
  "MysticRavenx", "MysticTTV", "MysticYetiPrime", "Mystic_Cobra548", "Mystic_Hunter469", "Mystic_Knight",
  "Mystic_Ninja362", "Mystic_Pulse166", "Mysticx", "NeonPhoenix", "NeonShadow", "NeonTV",
  "Neon_Eagle349", "Neon_Fury", "Neon_Quasar595", "Neon_Titan311", "Neon_Titan377", "NexusDragon",
  "NexusFuryOne", "NexusGuardianZero", "Nexus_Falcon", "Nexusx", "NinjaMaster5570", "NinjaMaster7631",
  "NomadMaster4278", "NomadMaster9901", "NovaMaster308", "NovaMaster4195", "NovaMaster447", "NovaOrcaZero",
  "NovaPulseXL", "NovaSentinelMode", "NovaShadowHD", "NovaTV", "NovaTitan99", "Nova_Beast486",
  "Nova_Dragon", "Nova_Phoenix", "Nova_Shadow", "Nova_Vanguard85", "ObsidianOne", "ObsidianTTV",
  "Obsidian_Knight939", "Obsidian_Ninja", "Obsidian_Striker", "Obsidian_Titan", "Obsidian_Xeno", "Obsidian_Yeti124",
  "OmegaBeast", "OmegaBeastXL", "OmegaNova", "OmegaPhantom", "OmegaPrime", "OmegaSamurai",
  "OmegaTV", "OmegaTitan", "Omega_Beast", "Omega_Hawk", "Omega_Impuls", "Omega_Maverick",
  "Omega_Nova", "Omega_Xeno429", "OrcaMaster156", "OrcaMaster8132", "OverlordMaster3630", "OverlordMaster4004",
  "OverlordMaster7916", "PhantomDemon", "PhantomMaster1547", "PhantomMaster2228", "PhantomMode", "PhantomNomad",
  "PhantomNova", "PhantomOne", "PhantomPRO", "PhantomRaven", "PhantomShadow007", "PhantomStrikerTTV",
  "PhantomTTV", "Phantom_Maverick334", "PhoenixMaster2916", "PhoenixMaster7500", "PixelCobra", "PixelKraken99",
  "PixelMode", "PixelPrime", "PixelViper", "PixelXL", "Pixel_Nova590", "Pixel_Predator406",
  "Pixel_Raven973", "PredatorMaster2815", "PsychoFX", "PsychoTV", "PsychoWarlock", "Psycho_Baron",
  "Psycho_Blade670", "Psycho_Demon757", "Psycho_Quasar481", "Psycho_Reaper305", "Psycho_Vanguard", "Psycho_Xeno510",
  "PulseMaster3099", "Pyro99", "PyroGod", "PyroOne", "PyroTitanHD", "Pyro_Guardian",
  "Pyro_Guardian527", "Pyro_Kraken772", "Pyro_Legend", "Pyro_Nomad", "Quantum99", "QuantumFX",
  "QuantumNinjaHD", "QuantumOverlordPRO", "QuantumPRO", "QuantumWarlockMode", "QuasarMaster2147", "QuasarMaster9603",
  "Rage99", "RageDragonFX", "RageRavenTTV", "Rage_Falcon900", "Rage_Juggernaut", "Rage_Spectre421",
  "Rage_Viper", "Rage_Warlock", "RangerMaster4837", "RangerMaster8399", "RavenMaster2293", "ReaperMaster4657",
  "RogueMode", "RogueNomadGod", "RoguePrime", "RogueShadow", "RogueTrooperPrime", "RogueVanguard99",
  "RogueWarrior", "Rogue_Eagle893", "Rogue_Shadow521", "Rogue_Yeti130", "Savage007", "SavageHD",
  "SavageJuggernautx", "SavagePrime", "SavageSentinel", "SavageTitanHD", "SavageWarlord", "Savage_Hawk",
  "Savage_Phantom", "SentinelMaster6130", "SentinelMaster9683", "ShadowDemon", "ShadowDragonPRO", "ShadowMaster6468",
  "ShadowPRO", "ShadowPhantom99", "ShadowZero", "Shadow_Legend", "Shadow_Orca", "Shadow_Phantom909",
  "Shadowx", "SlayerMaster279", "SlayerMaster8973", "SlayerMaster9724", "SniperMaster1027", "SniperMaster3252",
  "SniperMaster4632", "SniperMaster572", "SniperMaster724", "Storm007", "StormBaronFX", "StormCobra",
  "StormNomadXL", "StormOne", "StormRanger", "StormTrooperZone", "StormXL", "StormZealot",
  "Storm_Baron119", "Storm_Guardian51", "StrikerMaster5495", "TheRealAlphaNinja", "TheRealApexFury", "TheRealAtomicCobra",
  "TheRealBlitzBeast", "TheRealBlitzCobra", "TheRealCrimsonYeti", "TheRealCyberReaper", "TheRealCyberTitan", "TheRealDarkEagle",
  "TheRealDarkImpuls", "TheRealDreadPredator", "TheRealDreadViper", "TheRealEchoDemon", "TheRealEchoImpuls", "TheRealEchoNova",
  "TheRealFluxWarrior", "TheRealFrostFury", "TheRealFrostTitan", "TheRealGigaFury", "TheRealGigaMaverick", "TheRealGigaNova",
  "TheRealGigaRaven", "TheRealHavokDragon", "TheRealHavokImpuls", "TheRealHavokNomad", "TheRealHyperAsassin", "TheRealHyperKraken",
  "TheRealHyperOrca", "TheRealHyperPulse", "TheRealInfernoNova", "TheRealIronEagle", "TheRealIronOverlord", "TheRealIronXeno",
  "TheRealJadeFury", "TheRealJadePredator", "TheRealJadeWarlord", "TheRealKryptonCobra", "TheRealKryptonFury", "TheRealKryptonGhost",
  "TheRealKryptonSentinel", "TheRealKryptonTrooper", "TheRealLethalLegend", "TheRealLethalStriker", "TheRealLethalTrooper", "TheRealLunarDragon",
  "TheRealLunarZealot", "TheRealMysticBlade", "TheRealNeonBlade", "TheRealNeonJuggernaut", "TheRealNeonKnight", "TheRealNovaFalcon",
  "TheRealNovaQuasar", "TheRealNovaSamurai", "TheRealNovaTrooper", "TheRealObsidianHunter", "TheRealObsidianSentinel", "TheRealOmegaBaron",
  "TheRealOmegaEagle", "TheRealOmegaGhost", "TheRealPhantomPhoenix", "TheRealPixelEagle", "TheRealPixelFalcon", "TheRealPixelJuggernaut",
  "TheRealPixelSniper", "TheRealPsychoMaverick", "TheRealPsychoTitan", "TheRealPyroEagle", "TheRealPyroNomad", "TheRealPyroPulse",
  "TheRealQuantumReaper", "TheRealQuantumShadow", "TheRealRageGuardian", "TheRealRageJuggernaut", "TheRealRogueGuardian", "TheRealRogueJuggernaut",
  "TheRealRoguePhantom", "TheRealSavageYeti", "TheRealShadowMaverick", "TheRealShadowNova", "TheRealShadowRanger", "TheRealShadowSamurai",
  "TheRealStormFalcon", "TheRealStormNinja", "TheRealStormQuasar", "TheRealStormSamurai", "TheRealStormSniper", "TheRealTitanCobra",
  "TheRealTitanJuggernaut", "TheRealTitanPhantom", "TheRealToxicShadow", "TheRealUltraCobra", "TheRealUltraImpuls", "TheRealUltraLegend",
  "TheRealUltraSniper", "TheRealUltraVanguard", "TheRealUltraXeno", "TheRealUltraYeti", "TheRealValiantSpectre", "TheRealVenomOverlord",
  "TheRealVenomSamurai", "TheRealWickedBlade", "TheRealWickedShadow", "TheRealXenonCobra", "TheRealXenonReaper", "TheRealZephyrPhantom",
  "TitanDemon", "TitanFalcon", "TitanJuggernautPrime", "TitanKraken", "TitanMaster2008", "TitanMaster2325",
  "TitanMode", "TitanPRO", "TitanReaper", "TitanZealotTTV", "Titan_Guardian290", "Titan_Phantom",
  "Titan_Sentinel160", "Titanx", "Toxic007", "ToxicBeast", "ToxicBlade", "ToxicDragon",
  "ToxicFalconXL", "ToxicJuggernautFX", "ToxicWarlordZero", "Toxic_Phantom", "Toxic_Shadow", "Toxic_Striker611",
  "Toxic_Trooper", "Toxic_Warrior395", "TrooperMaster9460", "TrooperMaster9907", "UltraBeastFX", "UltraHD",
  "UltraHawkHD", "UltraPhantomTV", "UltraReaper", "UltraSamuraiOne", "UltraSlayer", "UltraVanguardTV",
  "UltraWarlock", "Ultra_Eagle936", "Ultra_Ghost", "Ultra_Maverick", "Ultra_Spectre", "Ultra_Viper",
  "ValiantBeast", "ValiantFalcon", "ValiantOne", "ValiantPRO", "ValiantPrime", "ValiantXL",
  "Valiant_Kraken841", "Valiant_Quasar137", "Valiant_Samurai", "VanguardMaster5853", "VanguardMaster8655", "VanguardMaster8810",
  "VanguardMaster9529", "VenomCobraMode", "VenomFuryZero", "VenomMode", "VenomPredatorMode", "VenomPredatorPRO",
  "VenomShadowPrime", "VenomSpectrex", "VenomTTV", "VenomTitan", "VenomZealotZone", "Venom_Fury166",
  "Venom_Fury516", "Venom_Hunter", "ViperMaster6427", "ViperMaster8750", "ViperMaster9877", "VortexBeastZone",
  "VortexHD", "VortexKraken", "VortexSlayer", "Vortex_Hunter593", "Vortex_Juggernaut", "Vortex_Maverick",
  "Vortex_Nova", "Vortex_Orca577", "Vortex_Striker981", "Vortex_Vanguard14", "Vortexx", "WarlockMaster3972",
  "WarlockMaster5487", "WarlockMaster8395", "WarlordMaster9443", "WarriorMaster1985", "WarriorMaster515", "WarriorMaster8100",
  "WarriorMaster9796", "WickedFalcon", "WickedGhost", "WickedMode", "WickedWarlockFX", "WickedZone",
  "Wicked_Beast", "Wicked_Demon", "XenoMaster3859", "XenoMaster7964", "Xenon99", "XenonEagle99",
  "XenonHunterOne", "XenonOrca", "XenonPrime", "XenonReaperPRO", "XenonStrikerXL", "Xenon_Asassin",
  "Xenon_Baron520", "Xenon_Ghost188", "Xenon_Impuls", "Xenon_Overlord", "Xenon_Ranger", "Xenon_Sniper421",
  "Xenonx", "YetiMaster6037", "YetiMaster6277", "YetiMaster6694", "ZephyrDragonPrime", "ZephyrGod",
  "ZephyrHD", "ZephyrImpuls", "ZephyrNomad", "ZephyrOne", "ZephyrPRO", "ZephyrTrooper",
  "ZephyrVanguard", "ZephyrYetiFX", "Zephyr_Guardian151", "Zephyr_Orca", "Zephyr_Phoenix", "Zephyr_Pulse692",
  "Zephyr_Warlock950", "Zephyr_Warlock959", "Zephyrx", "iTz_Apex", "iTz_Astro", "iTz_Atomic",
  "iTz_Blaze", "iTz_Blitz", "iTz_Blunt", "iTz_Chaos", "iTz_Crimson", "iTz_Cyber",
  "iTz_Dark", "iTz_Dread", "iTz_Echo", "iTz_Ember", "iTz_Frost", "iTz_Giga",
  "iTz_Havok", "iTz_Hyper", "iTz_Iron", "iTz_Jade", "iTz_Krypton", "iTz_Lethal",
  "iTz_Lunar", "iTz_Neon", "iTz_Nexus", "iTz_Nova", "iTz_Obsidian", "iTz_Omega",
  "iTz_Pixel", "iTz_Psycho", "iTz_Pyro", "iTz_Quantum", "iTz_Rogue", "iTz_Savage",
  "iTz_Shadow", "iTz_Storm", "iTz_Titan", "iTz_Ultra", "iTz_Valiant", "iTz_Venom",
  "iTz_Vortex", "iTz_Wicked", "iTz_Xenon", "xX_AlphaShadow_Xx", "xX_ApexRanger_Xx", "xX_ApexStriker_Xx",
  "xX_ApexViper_Xx", "xX_AstroPredator_Xx", "xX_AtomicBlade_Xx", "xX_BlazeSamurai_Xx", "xX_BlazeVanguard_Xx", "xX_BlazeXeno_Xx",
  "xX_BlitzXeno_Xx", "xX_ChaosDragon_Xx", "xX_ChaosHunter_Xx", "xX_ChaosPredator_Xx", "xX_ChaosSpectre_Xx", "xX_CrimsonRanger_Xx",
  "xX_CyberBlade_Xx", "xX_DarkFalcon_Xx", "xX_DarkRanger_Xx", "xX_DarkZealot_Xx", "xX_DreadGuardian_Xx", "xX_EchoCobra_Xx",
  "xX_EchoNova_Xx", "xX_EchoRanger_Xx", "xX_EchoSentinel_Xx", "xX_EmberHawk_Xx", "xX_EmberRanger_Xx", "xX_EmberSamurai_Xx",
  "xX_FluxRaven_Xx", "xX_FluxReaper_Xx", "xX_FluxVanguard_Xx", "xX_FrostHunter_Xx", "xX_FrostTitan_Xx", "xX_GigaZealot_Xx",
  "xX_HavokDemon_Xx", "xX_HavokYeti_Xx", "xX_HyperDemon_Xx", "xX_HyperGuardian_Xx", "xX_HyperKnight_Xx", "xX_HyperYeti_Xx",
  "xX_HyperZealot_Xx", "xX_InfernoQuasar_Xx", "xX_InfernoXeno_Xx", "xX_IronBeast_Xx", "xX_JadeFury_Xx", "xX_JadeGhost_Xx",
  "xX_JadeKnight_Xx", "xX_JadeRaven_Xx", "xX_LethalFalcon_Xx", "xX_MysticAsassin_Xx", "xX_MysticBeast_Xx", "xX_NexusOrca_Xx",
  "xX_NovaGuardian_Xx", "xX_ObsidianPredator_Xx", "xX_ObsidianSentinel_Xx", "xX_OmegaJuggernaut_Xx", "xX_OmegaKraken_Xx", "xX_OmegaOverlord_Xx",
  "xX_OmegaTrooper_Xx", "xX_OmegaZealot_Xx", "xX_PhantomJuggernaut_Xx", "xX_PhantomReaper_Xx", "xX_PixelBaron_Xx", "xX_PixelYeti_Xx",
  "xX_PsychoBlade_Xx", "xX_PsychoHawk_Xx", "xX_PsychoVanguard_Xx", "xX_PyroOverlord_Xx", "xX_PyroShadow_Xx", "xX_QuantumLegend_Xx",
  "xX_QuantumShadow_Xx", "xX_QuantumViper_Xx", "xX_RageSpectre_Xx", "xX_RageYeti_Xx", "xX_RogueOverlord_Xx", "xX_RoguePhantom_Xx",
  "xX_RoguePhoenix_Xx", "xX_RogueSniper_Xx", "xX_SavageCobra_Xx", "xX_SavageFalcon_Xx", "xX_SavageShadow_Xx", "xX_SavageTitan_Xx",
  "xX_ShadowHunter_Xx", "xX_ShadowKraken_Xx", "xX_ShadowWarlord_Xx", "xX_StormGuardian_Xx", "xX_StormMaverick_Xx", "xX_StormViper_Xx",
  "xX_TitanNova_Xx", "xX_TitanSentinel_Xx", "xX_ToxicBeast_Xx", "xX_ToxicNomad_Xx", "xX_ToxicSentinel_Xx", "xX_UltraBlade_Xx",
  "xX_UltraCobra_Xx", "xX_UltraGuardian_Xx", "xX_UltraSlayer_Xx", "xX_ValiantXeno_Xx", "xX_VenomSamurai_Xx", "xX_VortexQuasar_Xx",
  "xX_XenonFalcon_Xx", "xX_XenonNova_Xx", "xX_XenonSlayer_Xx", "xX_ZephyrLegend_Xx", "xX_ZephyrNinja_Xx", "xX_ZephyrNova_Xx",
  "xX_ZephyrOverlord_Xx", "xX_ZephyrViper_Xx", "xX_ZephyrYeti_Xx", "xX_ZephyrZealot_Xx",
];

/**
 * Le pseudo que l'anonymisation posait **avant** la liste : `compte_supprime_<id>`.
 *
 * Il nommait l'identifiant du compte, donc un fait de plus sur la personne, et
 * c'est à lui que le rattrapage de démarrage reconnaît une ligne anonymisée sous
 * l'ancienne règle (`lib/server/deleted-accounts-catchup.ts`).
 */
export function isLegacyDeletedPseudo(pseudo: string): boolean {
  return /^compte_supprime_\d+$/.test(pseudo);
}

/** Nombre de suffixes essayés avant de s'en remettre à un suffixe long. */
const SUFFIX_ATTEMPTS = 50;

/**
 * Tire un pseudo d'emprunt **libre**.
 *
 * `taken` liste les pseudos déjà portés, par un compte vivant comme par un
 * compte supprimé : `bg_users.pseudo` est unique, et sa collation l'est **sans
 * casse** — `alphafury` bloque donc `AlphaFury`, d'où la comparaison en
 * minuscules. Un joueur qui s'appelle déjà comme un pseudo de la liste le
 * garde, le tirage passe simplement à côté.
 *
 * La liste épuisée (mille comptes supprimés, ou autant de joueurs qui portent
 * ses noms), un pseudo tiré reçoit un suffixe numérique : l'anonymisation ne
 * doit jamais échouer faute de nom. Le résultat tient toujours dans la colonne
 * (les pseudos de la liste font au plus 23 caractères).
 */
export function pickAnonymousPseudo(
  taken: Iterable<string>,
  random: () => number = Math.random,
): string {
  const used = new Set(Array.from(taken, (pseudo) => pseudo.toLowerCase()));
  const free = ANONYMOUS_PSEUDOS.filter((pseudo) => !used.has(pseudo.toLowerCase()));
  if (free.length > 0) return free[randomIndex(free.length, random)];

  const base = ANONYMOUS_PSEUDOS[randomIndex(ANONYMOUS_PSEUDOS.length, random)];
  for (let attempt = 0; attempt < SUFFIX_ATTEMPTS; attempt += 1) {
    const candidate = `${base}${100 + randomIndex(9900, random)}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  // Cinquante collisions de suite ne se produisent pas avec un aléa honnête ;
  // avec un aléa figé (un test), le compteur garantit malgré tout un nom libre.
  let counter = 10_000;
  while (used.has(`${base}${counter}`.toLowerCase())) counter += 1;
  return `${base}${counter}`;
}

function randomIndex(length: number, random: () => number): number {
  // `random()` rend [0, 1) ; la borne haute est tenue même si un aléa mal
  // élevé rendait 1.
  return Math.min(length - 1, Math.floor(random() * length));
}

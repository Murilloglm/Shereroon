// Jogos: a lista de executáveis conhecidos e a detecção do jogo aberto a partir dos programas rodando no Windows.
// Só nomes (fatos públicos); nenhum logotipo ou imagem de terceiros. Programas genéricos (javaw.exe, por exemplo)
// ficam de fora: quem joga algo assim vincula o jogo à mão, com o nome que quiser.

export interface LinkedGame {
  id: string;
  name: string;
  exe: string | null;
  icon: string | null;
  showOnProfile: boolean;
  hidden: boolean;
}

export const KNOWN_GAMES: Record<string, string> = {
  'valorant-win64-shipping.exe': 'VALORANT',
  'league of legends.exe': 'League of Legends',
  'robloxplayerbeta.exe': 'Roblox',
  'minecraft.windows.exe': 'Minecraft',
  'cs2.exe': 'Counter-Strike 2',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'r5apex.exe': 'Apex Legends',
  'r5apex_dx12.exe': 'Apex Legends',
  'gta5.exe': 'Grand Theft Auto V',
  'gta5_enhanced.exe': 'Grand Theft Auto V',
  'overwatch.exe': 'Overwatch 2',
  'rocketleague.exe': 'Rocket League',
  'dota2.exe': 'Dota 2',
  'eldenring.exe': 'Elden Ring',
  'rainbowsix.exe': 'Rainbow Six Siege',
  'rainbowsix_be.exe': 'Rainbow Six Siege',
  'fc25.exe': 'EA SPORTS FC 25',
  'fc24.exe': 'EA SPORTS FC 24',
  'genshinimpact.exe': 'Genshin Impact',
  'starrail.exe': 'Honkai: Star Rail',
  'zenlesszonezero.exe': 'Zenless Zone Zero',
  'cod.exe': 'Call of Duty',
  'cod24-cod.exe': 'Call of Duty',
  'destiny2.exe': 'Destiny 2',
  'pubg.exe': 'PUBG: Battlegrounds',
  'tslgame.exe': 'PUBG: Battlegrounds',
  'deadbydaylight-win64-shipping.exe': 'Dead by Daylight',
  'amongus.exe': 'Among Us',
  'stardew valley.exe': 'Stardew Valley',
  'terraria.exe': 'Terraria',
  'hollow_knight.exe': 'Hollow Knight',
  'eurotrucks2.exe': 'Euro Truck Simulator 2',
  'witcher3.exe': 'The Witcher 3',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'bg3.exe': "Baldur's Gate 3",
  'bg3_dx11.exe': "Baldur's Gate 3",
  'palworld-win64-shipping.exe': 'Palworld',
  'helldivers2.exe': 'Helldivers 2',
  'marvel-win64-shipping.exe': 'Marvel Rivals',
  'deltaforceclient-win64-shipping.exe': 'Delta Force',
  'freefire.exe': 'Free Fire',
  'brawlhalla.exe': 'Brawlhalla',
  'paladins.exe': 'Paladins',
  'warframe.x64.exe': 'Warframe',
  'pathofexile.exe': 'Path of Exile',
  'pathofexile_x64steam.exe': 'Path of Exile',
  'pathofexile2.exe': 'Path of Exile 2',
  'lethal company.exe': 'Lethal Company',
  'phasmophobia.exe': 'Phasmophobia',
  'fallguys_client_game.exe': 'Fall Guys',
  'sons of the forest.exe': 'Sons of the Forest',
  'rust.exe': 'Rust',
  'satisfactory.exe': 'Satisfactory',
  'factorio.exe': 'Factorio',
};

/**
 * O jogo aberto agora, entre os programas rodando (nomes de executável). Os jogos que a pessoa vinculou vêm
 * primeiro e com o nome que ela deu; depois a lista conhecida. Um jogo marcado como oculto nunca é informado.
 */
export function detectGame(running: readonly string[], linked: readonly LinkedGame[]): { name: string; exe: string } | null {
  const open = new Set(running.map((exe) => exe.toLowerCase()));
  const hidden = new Set(linked.filter((game) => game.hidden && game.exe).map((game) => game.exe!.toLowerCase()));
  for (const game of linked) {
    const exe = game.exe?.toLowerCase();
    if (exe && !game.hidden && open.has(exe)) return { name: game.name, exe };
  }
  for (const [exe, name] of Object.entries(KNOWN_GAMES)) {
    if (open.has(exe) && !hidden.has(exe)) return { name, exe };
  }
  return null;
}

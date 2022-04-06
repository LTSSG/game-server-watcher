"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameServer = exports.saveDb = exports.initDb = void 0;
const got_1 = __importDefault(require("got"));
const gamedig_1 = require("gamedig");
const lowdb_1 = require("@commonify/lowdb");
const ipregex_1 = __importDefault(require("./lib/ipregex"));
const getip_1 = __importDefault(require("./lib/getip"));
const STEAM_WEB_API_KEY = process.env.STEAM_WEB_API_KEY || '';
const PLAYERS_HISTORY_HOURS = parseInt(process.env.PLAYERS_HISTORY_HOURS || '12', 10);
const DATA_PATH = process.env.DATA_PATH || './data/';
const adapter = new lowdb_1.JSONFile(DATA_PATH + 'servers.json');
const db = new lowdb_1.Low(adapter);
async function initDb() {
    await db.read();
    db.data = db.data || {
        population: {}
    };
}
exports.initDb = initDb;
async function saveDb() {
    try {
        return await db.write();
    }
    catch (e) {
        console.error(e.message || e);
    }
}
exports.saveDb = saveDb;
class GameServer {
    constructor(config) {
        this.online = false;
        console.log('game-server init', config.host, config.port, config.type, config.appId);
        this.config = config;
        this.history = new ServerHistory(config.host + ':' + config.port);
        this._niceName = config.host + ':' + config.port;
    }
    async update() {
        let info = await this.gamedig();
        if (!info && STEAM_WEB_API_KEY) {
            info = await this.steam();
        }
        if (info) {
            this.online = true;
            this.info = info;
            this.history.add(info);
        }
        else {
            this.online = false;
            console.error('game-server not available', this.config.host, this.config.port);
        }
    }
    async gamedig() {
        try {
            const res = await (0, gamedig_1.query)({
                host: this.config.host,
                port: this.config.port,
                type: this.config.type,
            });
            const raw = res.raw;
            const game = raw.game || raw.folder || this.config.type;
            const players = res.players.map((p) => {
                return new GsPlayer(p);
            });
            return {
                connect: res.connect,
                name: res.name,
                game: game,
                map: res.map,
                playersNum: res.numplayers || res.players.length,
                playersMax: res.maxplayers,
                players
            };
        }
        catch (e) {
            console.error(e.message || e);
        }
        return null;
    }
    async steam() {
        if (!this.ip) {
            if (ipregex_1.default.test(this.config.host)) {
                this.ip = this.config.host;
            }
            else {
                this.ip = await (0, getip_1.default)(this.config.host);
                if (!this.ip) {
                    return null;
                }
            }
        }
        const reqUrl = 'https://api.steampowered.com/IGameServersService/GetServerList/v1/?filter=\\appid\\' + this.config.appId + '\\addr\\' + this.ip + '&key=' + STEAM_WEB_API_KEY;
        try {
            const res = await (0, got_1.default)(reqUrl, {
                responseType: 'json',
                headers: { 'user-agent': 'game-server-watcher/1.0' }
            }).json();
            if (Array.isArray(res.response.servers)) {
                const matching = res.response.servers.find((s) => s.gameport === this.config.port);
                if (matching) {
                    return {
                        connect: matching.addr,
                        name: matching.name,
                        game: matching.gamedir,
                        map: matching.map,
                        playersNum: matching.players,
                        playersMax: matching.max_players,
                        players: []
                    };
                }
            }
        }
        catch (e) {
            console.error(e.message || e);
        }
        return null;
    }
    get niceName() {
        var _a;
        let nn = (_a = this.info) === null || _a === void 0 ? void 0 : _a.name;
        if (nn) {
            for (let i = 0; i < nn.length; i++) {
                if (nn[i] == '^') {
                    nn = nn.slice(0, i) + ' ' + nn.slice(i + 2);
                }
                else if (nn[i] == '█') {
                    nn = nn.slice(0, i) + ' ' + nn.slice(i + 1);
                }
                else if (nn[i] == '�') {
                    nn = nn.slice(0, i) + ' ' + nn.slice(i + 2);
                }
                ;
            }
            ;
            if (nn)
                this._niceName = nn;
        }
        return this._niceName;
    }
}
exports.GameServer = GameServer;
class GsPlayer {
    constructor(p) {
        this._player = p;
    }
    get(prop) {
        const p = this._player;
        if (p[prop] !== undefined) {
            return String(p[prop]);
        }
        else if (p.raw && p.raw[prop] !== undefined) {
            return String(p.raw[prop]);
        }
        return undefined;
    }
}
class ServerHistory {
    constructor(id) {
        this.id = id;
    }
    yyyymmddhh(d) {
        return parseInt(d.toISOString().slice(0, 13).replace(/\D/g, ''), 10);
    }
    add(info) {
        var _a;
        if (!((_a = db.data) === null || _a === void 0 ? void 0 : _a.population))
            return;
        const d = new Date();
        const dh = this.yyyymmddhh(d);
        if (!db.data.population[this.id]) {
            db.data.population[this.id] = [];
        }
        db.data.population[this.id].push({
            dateHour: dh,
            playersNum: info.playersNum
        });
        d.setHours(d.getHours() - PLAYERS_HISTORY_HOURS);
        const minDh = this.yyyymmddhh(d);
        db.data.population[this.id] = db.data.population[this.id].filter(i => i.dateHour > minDh);
    }
    stats() {
        var _a;
        if (!((_a = db.data) === null || _a === void 0 ? void 0 : _a.population))
            return [];
        const grouped = {};
        for (const d of db.data.population[this.id]) {
            if (!grouped[d.dateHour]) {
                grouped[d.dateHour] = [];
            }
            grouped[d.dateHour].push(d);
        }
        const stats = [];
        for (const dh in grouped) {
            const avg = grouped[dh].reduce((total, next) => total + next.playersNum, 0) / grouped[dh].length;
            const max = grouped[dh].reduce((max, next) => next.playersNum > max ? next.playersNum : max, 0);
            stats.push({
                dateHour: parseInt(dh, 10),
                avg,
                max
            });
        }
        return stats.sort((a, b) => a.dateHour - b.dateHour);
    }
}

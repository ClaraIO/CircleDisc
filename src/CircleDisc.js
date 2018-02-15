const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');
const {EventEmitter} = require('events');

class CircleDisc extends EventEmitter {
    constructor(url, port) {
        super();

        if (!url) {
            throw new Error('URL is not specified!');
        }

        if (!port) {
            throw new Error('Port/Server is not specified!');
        }

        this.server = port instanceof http.Server ? port : http.createServer();
        this.port = port;
        this.plugins = {};
        const parts = url.split('/webhooks/')[1].split('?')[0].split('/');

        this.id = parts[0];
        this.token = parts[1];

        this.server.once('listening', () => this.emit('ready'));

        this.loadPlugins();
    }

    loadPlugins(dir = 'plugins') {
        const files = fs.readdirSync(path.join(__dirname, dir)).filter(f => f.endsWith('.js'));

        for (const file of files) {
            const plugin = require(path.join(__dirname, dir, file));

            if (!plugin.hasOwnProperty('execute') || !plugin.name) {
                continue;
            }

            this.plugins[plugin.name.toLowerCase()] = plugin.execute;
        }
    }

    startListening() {
        if (!this.server.listening) {
            this.server.listen(this.port);
        }

        this.server.on('request', (req, res) => this._onRequest(req, res));
    }

    shutdown(cb) {
        return this.server.close(cb || (() => {}));
    }

    _sendRequest(obj) {
        return new Promise((resolve, reject) => {
            if (!obj) {
                return reject('No data object given');
            }

            const data = {
                avatar_url: obj.logo,
                username: obj.service,
                embeds: [obj.embed],
                tts: false,
                content: null
            };

            const req = https.request({
                protocol: 'https:',
                hostname: 'discordapp.com',
                path: `/api/v6/webhooks/${this.id}/${this.token}?wait=true`,
                method: 'POST',
                headers: {
                    'User-Agent': `CircleDisc (https://github.com/ClarityMoe/CircleDisc, ${require('../package.json').version})`,
                    'Content-Type': 'application/json'
                }
            }, res => {
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    this.emit('requestCompleted', chunk);
                    resolve();
                });
            });

            req.on('error', e => {
                console.error(`Cought an error while trying to send data to Discord: ${e.message}`);
                reject(e.message);
            });

            req.end(JSON.stringify(data));
        });
    }

    _onRequest(req, res) {
        if (!req || !(req instanceof http.IncomingMessage)) {
            throw new Error('Request object is not an IncomingMessage');
        }

        if (!res || !(res instanceof http.ServerResponse)) {
            throw new Error('Response object is not a ServerResponse');
        }

        if (req.method !== 'POST') {
            return res.end(
                JSON.stringify({
                    error: true,
                    message: 'Method is not POST'
                })
            );
        }

        const path = req.url.split('?')[0].split('/').slice(1);

        let body = [];

        req.on('error', console.error);

        req
            .on('data', chunk => body.push(chunk))
            .once('end', () => {
                switch (path[0]) {
                case 'webhook': {
                    if (!path[1] || !this.plugins.hasOwnProperty(path[1])) {
                        return res.end(
                            JSON.stringify({
                                error: true,
                                message: 'Invalid service'
                            })
                        );
                    }

                    if (!req.headers.hasOwnProperty('content-type')) {
                        return res.end(
                            JSON.stringify({
                                error: true,
                                message: 'Content-Type header is not set'
                            })
                        );
                    }

                    if (req.headers['content-type'].startsWith('application/json')) {
                        body = JSON.parse(Buffer.concat(body).toString());
                    } else if (req.headers['content-type'].startsWith('application/x-www-form-urlencoded')) {
                        body = qs.parse(Buffer.concat(body).toString());
                    }

                    const exec = this.plugins[path[1]];

                    this._sendRequest(exec(body))
                        .then(() => {
                            res.end(
                                JSON.stringify({
                                    error: false,
                                    message: 'OK'
                                })
                            );
                        })
                        .catch(err => {
                            res.end(
                                JSON.stringify({
                                    error: true,
                                    message: err
                                })
                            );
                        });

                    break;
                }

                default: {
                    res.end(
                        JSON.stringify({
                            error: true,
                            message: `Invalid endpoint ${path[0]}`
                        })
                    );
                }
                }
            });
    }
}

module.exports = CircleDisc;

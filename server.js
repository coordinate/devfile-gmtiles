const Prometheus = require('prom-client');
const express = require('express');
const http = require('http');
const fetch = require('node-fetch');

const UserAgents = [
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:76.0) Gecko/20100101 Firefox/76.0',
  'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/36.0.1985.143 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:77.0) Gecko/20100101 Firefox/77.0',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36',
];

Prometheus.collectDefaultMetrics();

const requestHistogram = new Prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['code', 'handler', 'method'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const requestTimer = (req, res, next) => {
  const path = new URL(req.url, `http://${req.hostname}`).pathname;
  const stop = requestHistogram.startTimer({
    method: req.method,
    handler: path,
  });
  res.on('finish', () => {
    stop({
      code: res.statusCode,
    });
  });
  next();
};

const app = express();
const server = http.createServer(app);

// See: http://expressjs.com/en/4x/api.html#app.settings.table
const PRODUCTION = app.get('env') === 'production';

// Administrative routes are not timed or logged, but for non-admin routes, pino
// overhead is included in timing.
app.get('/ready', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/live', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/metrics', async (req, res, next) => {
  const metrics = await Prometheus.register.metrics();
  res.set('Content-Type', Prometheus.register.contentType);
  res.end(metrics);
});

// Time routes after here.
app.use(requestTimer);

// Log routes after here.
const pino = require('pino')({
  level: PRODUCTION ? 'info' : 'debug',
});
app.use(require('pino-http')({ logger: pino }));

app.get('/', async (req, res) => {
  const p = req.query;
  if (!p.hasOwnProperty('xys')) {
    res.send('404 Server Error');
    return;
  }
  const getFile = (v, x, y, z, s) => {
    let radom = Math.floor(Math.random() * 4);
    let url =
      // 'https://puce-sheep-8374.twil.io/gmtile?v=' +
      'https://khm' +
      radom +
      '.google.com/kh/v=' +
      v +
      '&hl=en&x=' +
      x +
      '&y=' +
      y +
      '&z=' +
      z +
      '&s=' +
      s;
    return new Promise((resolve, reject) => {
      fetch(url, {
        method: 'Get',
        headers: {
          'User-Agent': UserAgents[radom],
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language':
            'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
          'Upgrade-Insecure-Requests': '1',
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
        },
      })
        .then((res) => {
          const chunks = [];
          res.body.on('data', (chunk) => chunks.push(chunk));
          res.body.on('end', () => {
            //at this point data is an array of Buffers
            //so Buffer.concat() can make us a new Buffer
            //of all of them together
            let buffer = Buffer.concat(chunks);
            resolve(buffer.toString('hex'));
          });
        })
        .catch((error) => reject(error));
    });
  };
  let promises = [];
  let xys = p.xys.split('.');
  let l = xys.length;
  for (let i = 0; i < l; i = i + 2) {
    let x = xys[i];
    let y = xys[i + 1];
    promises.push(getFile(p.v, x, y, p.z, p.s));
  }
  try {
    let result = await Promise.all(promises);
    res.send(JSON.stringify({ result }));
  } catch (error) {
    console.log(error);
    res.send('500 Server Error');
  }
  // res.send('1111111111!');
});

app.get('*', (req, res) => {
  res.status(404).send('Not Found');
});

// Listen and serve.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`App started on PORT ${PORT}`);
});

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout } = require('timers/promises');
const fs = require('fs');
const os = require('os');

const EXECUTE_SCRIPT_USER = os.userInfo().username;
const MODULE_PATH = path.resolve('package');

const NPM_DEFAULT_PASSWORD = process.env.NPM_DEFAULT_PASSWORD || 'fake-password';
const NPM_REGISTRY_ADDR = process.env.NPM_REGISTRY_ADDR || 'http://registry:4873';
const USER_1_NPM_TOKEN = process.env.USER_1_NPM_TOKEN || 'invalid-token';
const USER_2_NPM_TOKEN = process.env.USER_2_NPM_TOKEN || 'invalid-token';

const NPM_RC_DATA = fs.readFileSync(path.resolve('.npmrc'), 'utf8');
if (EXECUTE_SCRIPT_USER === 'root') {
  fs.writeFileSync('/root/.npmrc', NPM_RC_DATA, 'utf8');
} else {
  fs.writeFileSync(`/home/${EXECUTE_SCRIPT_USER}/.npmrc`, NPM_RC_DATA, 'utf8');
}

const usersInfo = {
  'user-1': {
    pass: NPM_DEFAULT_PASSWORD,
    token: USER_1_NPM_TOKEN,
  },
  'user-2': {
    pass: NPM_DEFAULT_PASSWORD,
    token: USER_2_NPM_TOKEN,
  },
};
const moduleList = [
  {
    name: 'registry-test1',
    owner: 'user-1',
  },
  {
    name: 'registry-test2',
    owner: 'user-2',
  },
];

/**
 *
 * Create new users and get token
 * @param user
 * @returns {Promise<string|null>}
 */
async function createUser(user) {
  const data = JSON.stringify({
    name: user.name,
    password: user.pass,
  });
  const url = new URL(NPM_REGISTRY_ADDR);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: `/-/user/org.couchdb.user:${user.name}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let resBodyStr = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        resBodyStr += chunk;
      });
      res.on('end', () => {
        const resBody = JSON.parse(resBodyStr);

        if (res.statusCode === 409 && resBody.error === 'username is already registered') {
          return resolve(null);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(resBody.token);
        }

        const error = new Error('Fail execute request');
        error.data = resBody;

        reject(error);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

/**
 *
 * Get token from exist user
 * @param user
 * @returns {Promise<string>}
 */
async function loginUser(user) {
  const data = JSON.stringify({
    password: user.pass,
    readonly: false,
    cidr_whitelist: ['*'],
  });
  const url = new URL(NPM_REGISTRY_ADDR);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: `/-/npm/v1/tokens`,
    method: 'POST',
    auth: `${user.name}:${user.pass}`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let resBodyStr = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        resBodyStr += chunk;
      });
      res.on('end', () => {
        const resBody = JSON.parse(resBodyStr);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(resBody.token);
        }

        const error = new Error('Fail execute request');
        error.data = resBody;

        reject(error);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

/**
 *
 * Check token is valid or not
 * @param token
 * @returns {Promise<boolean>}
 */
async function isValidAuth(token) {
  const url = new URL(NPM_REGISTRY_ADDR);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: `/-/npm/v1/user`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let resBodyStr = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        resBodyStr += chunk;
      });
      res.on('end', () => {
        const resBody = JSON.parse(resBodyStr);

        if (res.statusCode === 401) {
          return resolve(false);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(true);
        }

        const error = new Error('Fail execute request');
        error.data = resBody;

        reject(error);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write('');
    req.end();
  });
}

/**
 * Get user token for publish
 * @param user
 * @returns {Promise<string>}
 */
async function getToken(user) {
  const isLogin = await isValidAuth(user.token);
  if (isLogin) {
    return user.token;
  }

  let token = null;

  token = await createUser(user);

  if (!token) {
    token = await loginUser(user);
  }

  usersInfo[user.name].token = token;

  return token;
}

/**
 * Publish package
 * @param token
 * @param moduleName
 * @returns {Promise<void>}
 */
async function publish(token, moduleName) {
  const exec = spawn('npm', ['publish', '--info', path.resolve(MODULE_PATH, moduleName)], { env: { NPM_TOKEN: token } });
  let executeError = '';
  for await (const chunk of exec.stderr) {
    if (/(npm notice|notice|Tarball).*|/.exec(chunk.toString())) {
      continue;
    }
    executeError += chunk;
  }

  let executeData = '';
  for await (const chunk of exec.stdout) {
    executeData += chunk;
  }

  if (executeError) {
    const error = new Error('Fail execute command');
    error.data = executeError;

    throw error;
  }

  return null;
}

/**
 * Unpublished package
 * @param token
 * @param moduleName
 * @returns {Promise<boolean>}
 */
async function unpublish(token, moduleName) {
  const exec = spawn('npm', ['unpublish', '--silent', moduleName, '-f'], { env: { NPM_TOKEN: token } });

  let executeError = '';
  for await (const chunk of exec.stderr) {
    executeError += chunk;
  }

  let executeData = '';
  for await (const chunk of exec.stdout) {
    executeData += chunk;
  }

  if (/code E404/.exec(executeError)) {
    return null;
  }
  if (executeError) {
    const error = new Error('Fail execute command');
    error.data = executeError;

    throw error;
  }

  return null;
}

/**
 *
 * @returns {AsyncGenerator<*&{name: string, pass: string, token: string}, void, *>}
 */
async function *userAsyncGenerator() {
  let i = 0;
  const keys = Object.keys(usersInfo);
  for (let i = 0; i < keys.length; i++) {
    const user = keys[i];

    yield {
      name: user,
      ...usersInfo[user],
    };
  }
}

(async () => {
  console.log('Wait 6 sec until registry is up');
  await setTimeout(6000);

  try {
    for await (const user of userAsyncGenerator()) {
      let token = null;
      token = await getToken(user);

      const moduleName = moduleList.find((v) => v.owner === user.name);
      await unpublish(token, moduleName.name);
    }

    for await (const user of userAsyncGenerator()) {
      let token = null;
      token = await getToken(user);

      const moduleName = moduleList.find((v) => v.owner === user.name);
      await publish(token, moduleName.name);
    }

    console.log('DONE');

    setInterval(() => {}, 6000);
  } catch (error) {
    console.error('ERR', error);

    process.exit(1);
  }
})();

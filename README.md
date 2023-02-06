Introduction
============

This is a sample for create/login and get token from npm registry. This service show you how to do log in and push your
module in npm registry with multiply token.

Scenario
========

This sample code is too sample. According to [index.js](app/index.js) file we have below scenario:

1. At first, we generate [.npmrc](app/.npmrc) file
2. Then we try to get token for each user (`user-1`, `user-2`)
3. If token is valid on variable **usersInfo** use it else get token with create/login user or create token API
4. If user not found in system, We get token create user with login API
5. If user founded in system, We get token with create token API
6. After get token from registry, We unpublished modules (`registry-test1`, `registry-test1`)
7. Then we publish modules for each user with user's token (use npm command)

Installation
============

For demo and check all things is work you have to use docker for see how it works.

Install:

```bash
NPM_DEFAULT_PASSWORD=your-defualt-password docker-compose up -d
```

Remove:

```bash
docker-compose down -v
```

Reference
=========

1) https://github.com/npm/registry/blob/master/docs/user/authentication.md

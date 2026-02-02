# Changelog

## 0.1.2 (2025-10-07)

Full Changelog: [v0.1.1...v0.1.2](https://github.com/parallel-web/parallel-sdk-typescript/compare/v0.1.1...v0.1.2)

### Features

* **api:** Add progress meter to Task Run events ([ad361b3](https://github.com/parallel-web/parallel-sdk-typescript/commit/ad361b31f97286eed338be1388ab9806415596fa))


### Performance Improvements

* faster formatting ([173a244](https://github.com/parallel-web/parallel-sdk-typescript/commit/173a24423a23158782abe3f831bb0b8dc5eec5d9))


### Chores

* do not install brew dependencies in ./scripts/bootstrap by default ([285367b](https://github.com/parallel-web/parallel-sdk-typescript/commit/285367bd65f7b796416e7cbe151e771da85a3be6))
* **internal:** codegen related update ([ab2b45e](https://github.com/parallel-web/parallel-sdk-typescript/commit/ab2b45e909e512425400eb88f811fb34fdb48d2a))
* **internal:** fix incremental formatting in some cases ([dbe176c](https://github.com/parallel-web/parallel-sdk-typescript/commit/dbe176c606c8914cb803b302c43a93faf795147d))
* **internal:** ignore .eslintcache ([7d0c511](https://github.com/parallel-web/parallel-sdk-typescript/commit/7d0c511c79edc77690bd87be97e09789b768f541))
* **internal:** remove .eslintcache ([6998e86](https://github.com/parallel-web/parallel-sdk-typescript/commit/6998e8695537208a66139c4b61f59caf4aaf4a66))
* **internal:** remove deprecated `compilerOptions.baseUrl` from tsconfig.json ([aa7ffe8](https://github.com/parallel-web/parallel-sdk-typescript/commit/aa7ffe8af4fd9128e0da20a1702ef2f9b791a915))
* **internal:** use npm pack for build uploads ([799079d](https://github.com/parallel-web/parallel-sdk-typescript/commit/799079d180e8f2f691b8f28f27080ea4f465ceda))
* **jsdoc:** fix [@link](https://github.com/link) annotations to refer only to parts of the package‘s public interface ([5ed9433](https://github.com/parallel-web/parallel-sdk-typescript/commit/5ed9433661eacf6cb55f0a854ba68915862f737e))

## 0.1.1 (2025-09-15)

Full Changelog: [v0.1.0...v0.1.1](https://github.com/parallel-web/parallel-sdk-typescript/compare/v0.1.0...v0.1.1)

### Features

* **api:** Allow nullable text schemas ([855642a](https://github.com/parallel-web/parallel-sdk-typescript/commit/855642a846b1f746b53e29c3c34400b857457c43))


### Bug Fixes

* coerce nullable values to undefined ([077555c](https://github.com/parallel-web/parallel-sdk-typescript/commit/077555c9ae59da02a2500a2664e5128bce51eedc))


### Chores

* ci build action ([9cebcc7](https://github.com/parallel-web/parallel-sdk-typescript/commit/9cebcc7efaa12eb64002b2f9e765594c4e2bdd8b))

## 0.1.0 (2025-09-01)

Full Changelog: [v0.0.1-alpha.0...v0.1.0](https://github.com/parallel-web/parallel-sdk-typescript/compare/v0.0.1-alpha.0...v0.1.0)

### Features

* **api:** update via SDK Studio ([f4b9bff](https://github.com/parallel-web/parallel-sdk-typescript/commit/f4b9bff96e41c4e31546276be440fb8f721ef595))
* **api:** update via SDK Studio ([7a985fb](https://github.com/parallel-web/parallel-sdk-typescript/commit/7a985fbf420eed89c87940cef40efb650b554c9b))
* **api:** update via SDK Studio ([bea2209](https://github.com/parallel-web/parallel-sdk-typescript/commit/bea220934b8d11d97e35599dbc68ef3e69bb9523))
* **api:** update via SDK Studio ([e555533](https://github.com/parallel-web/parallel-sdk-typescript/commit/e5555331ceb4722741248522936df737ab26176e))
* **api:** update via SDK Studio ([e0922b7](https://github.com/parallel-web/parallel-sdk-typescript/commit/e0922b7ab408dd85495164111d53c3b9a1967da9))
* **api:** update via SDK Studio ([496a13a](https://github.com/parallel-web/parallel-sdk-typescript/commit/496a13a6922fc072d62c34fa5fb9917824bee881))
* **api:** update via SDK Studio ([bb43e98](https://github.com/parallel-web/parallel-sdk-typescript/commit/bb43e9850dcb30878dc67d8d5422917d951645b9))
* **client:** add support for endpoint-specific base URLs ([6ca9e40](https://github.com/parallel-web/parallel-sdk-typescript/commit/6ca9e405e47920c42ab274da43a40f20864fa7c7))
* **client:** add withOptions helper ([2dc5df5](https://github.com/parallel-web/parallel-sdk-typescript/commit/2dc5df50cfca28e611a360559c694889b9592939))


### Bug Fixes

* **client:** always overwrite when merging headers ([1b74500](https://github.com/parallel-web/parallel-sdk-typescript/commit/1b745008bbcff7583e8483a3989225fb6eb2719e))
* **client:** explicitly copy fetch in withOptions ([1e3c4cb](https://github.com/parallel-web/parallel-sdk-typescript/commit/1e3c4cbb08404440b34dc10dc67beb273fa658f3))
* **client:** get fetchOptions type more reliably ([c90df05](https://github.com/parallel-web/parallel-sdk-typescript/commit/c90df05c6ed462bffb1004861f33ed3f2ff4cdcc))
* compat with more runtimes ([b197b9f](https://github.com/parallel-web/parallel-sdk-typescript/commit/b197b9ffc02621b1743ba5ff52b59b524aef94b1))
* publish script — handle NPM errors correctly ([4c38358](https://github.com/parallel-web/parallel-sdk-typescript/commit/4c38358bade9566927ba83f123b06ea70d4c2140))


### Chores

* add docs to RequestOptions type ([6aae9a9](https://github.com/parallel-web/parallel-sdk-typescript/commit/6aae9a9b10709a8b53886f74e1a768f1b25e66d0))
* adjust eslint.config.mjs ignore pattern ([1685764](https://github.com/parallel-web/parallel-sdk-typescript/commit/1685764727dd8d217dad3a24257dac5777839b44))
* avoid type error in certain environments ([dc40584](https://github.com/parallel-web/parallel-sdk-typescript/commit/dc405849f7a23810049ea0409f9bdf4db785d149))
* change publish docs url ([cd7500b](https://github.com/parallel-web/parallel-sdk-typescript/commit/cd7500b70c2ec7d1dc9534a582619042be13eb53))
* **ci:** enable for pull requests ([2bd8a50](https://github.com/parallel-web/parallel-sdk-typescript/commit/2bd8a5000c5e442499ab1e7bd4186303e6e0539b))
* **ci:** only run for pushes and fork pull requests ([07a77b8](https://github.com/parallel-web/parallel-sdk-typescript/commit/07a77b81a447dc1b0f195a44db309913cd6eebcf))
* **client:** drop support for EOL node versions ([ae8f0d0](https://github.com/parallel-web/parallel-sdk-typescript/commit/ae8f0d0732f35ae967d1285cd3b6255f78822031))
* **client:** improve path param validation ([c64babf](https://github.com/parallel-web/parallel-sdk-typescript/commit/c64babf6852c1f078b4151f1a9a9e047686dc21f))
* **client:** refactor imports ([9ed8458](https://github.com/parallel-web/parallel-sdk-typescript/commit/9ed845857b38ff482b624eb171a4767965ce6562))
* **deps:** bump eslint-plugin-prettier ([326f222](https://github.com/parallel-web/parallel-sdk-typescript/commit/326f222fd6f1f305370681a2aad70ee2776f62e1))
* **docs:** grammar improvements ([9afb7db](https://github.com/parallel-web/parallel-sdk-typescript/commit/9afb7db5530567fc606fc2084172705b5cf3a627))
* **docs:** use top-level-await in example snippets ([15c8ab4](https://github.com/parallel-web/parallel-sdk-typescript/commit/15c8ab49b9e9438ccbb3b066def8d2c4ef0f8748))
* go live ([5e6dbbb](https://github.com/parallel-web/parallel-sdk-typescript/commit/5e6dbbb6f668125403e5261b6ce4bc80861eb627))
* improve publish-npm script --latest tag logic ([9feb9eb](https://github.com/parallel-web/parallel-sdk-typescript/commit/9feb9eb2fb9ee5d993872a8b8bc4ce30180f8084))
* **internal:** add pure annotations, make base APIResource abstract ([cf3a8d2](https://github.com/parallel-web/parallel-sdk-typescript/commit/cf3a8d27388f773c166c8283b0e89e9a16ae04e4))
* **internal:** codegen related update ([7dfd25b](https://github.com/parallel-web/parallel-sdk-typescript/commit/7dfd25bb7ed0a0b7d6a40d74d137b7f2d34c332c))
* **internal:** fix readablestream types in node 20 ([340f07e](https://github.com/parallel-web/parallel-sdk-typescript/commit/340f07e2c4f1db967f2f00c909b1283c5b0dbad3))
* **internal:** refactor utils ([95c2945](https://github.com/parallel-web/parallel-sdk-typescript/commit/95c2945cef58d5d7b13c968c70de500148705720))
* **internal:** share typescript helpers ([fa5b3f1](https://github.com/parallel-web/parallel-sdk-typescript/commit/fa5b3f1e6e9ad059adf73bc8475455247ec71df3))
* **internal:** update jest config ([b740c53](https://github.com/parallel-web/parallel-sdk-typescript/commit/b740c5312f264b90fd8b8690a5770209486f2e1f))
* make some internal functions async ([ae148ed](https://github.com/parallel-web/parallel-sdk-typescript/commit/ae148ede844821590bb04b6b5f07e7419660cda4))
* **package:** remove engines ([8c81289](https://github.com/parallel-web/parallel-sdk-typescript/commit/8c812899a5099a2a5fae23d9863effef9ae66581))
* **readme:** update badges ([10d3e6a](https://github.com/parallel-web/parallel-sdk-typescript/commit/10d3e6abff37d19ad633430f390f8d899d069bb3))
* **readme:** use better example snippet for undocumented params ([6b403ec](https://github.com/parallel-web/parallel-sdk-typescript/commit/6b403ecc4ed7dc04bf80d719cd357b3bfd32d47e))
* **ts:** reorder package.json imports ([4e6e456](https://github.com/parallel-web/parallel-sdk-typescript/commit/4e6e456893e96f2fb0d6cbbf4022193e4207f99e))


### Documentation

* **readme:** fix typo ([0c499fe](https://github.com/parallel-web/parallel-sdk-typescript/commit/0c499fe10500f3a667941cf8acbdf5d88cb67182))


### Refactors

* **types:** replace Record with mapped types ([ab87e9c](https://github.com/parallel-web/parallel-sdk-typescript/commit/ab87e9c8c2fdceaf24a3f310647bf0912c1c3dcb))

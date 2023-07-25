<img src="https://docs.swaap.finance/img/brand.png" alt="drawing" width="300"/>

# Swaap V2 Monorepo

[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.swaap.finance/)
[![CI Status](https://github.com/swaap-labs/swaap-v2-monorepo/workflows/CI/badge.svg?branch=staging)](https://github.com/swaap-labs/swaap-v2-monorepo/actions)
[![License](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)

This repository contains the Swaap V2 core smart contracts — along with their tests, configuration, and deployment information.

## Structure

The monorepo is has 3 main directories:

- [`pkg/`](./pkg): packages meant to be published and deployed. 

- [`dep/`](./dep): unpublished smart contract dependencies.

- [`pvt/`](./pvt): helpers and scripts for deployment and testing.

### Packages

- [`v2-interfaces`](./pkg/interfaces): Solidity interfaces for all Swaap V2 contracts.
- [`v2-errors`](./pkg/errors): the [`Errors`](./pkg/errors/contracts/SwaapV2Errors.sol) solidity library.
- [`v2-safeguard-pool`](./pkg/safeguard-pool): the [`SafeguardPool`](./pkg/safeguard-pool/contracts/SafeguardPool.sol) solidity contract.
- [`v2-vault`](./pkg/vault): the [`Vault`](./pkg/vault/contracts/Vault.sol) solidity contract, forked from Balancer V2.

## Clone
This repository uses git submodules to run fuzz tests using forge. Therefore use ```--recurse-submodules``` when cloning:

```bash
$ git clone --recurse-submodules https://github.com/swaap-labs/swaap-v2-monorepo.git
```

## Build and Test

Before any tests can be run, the repository needs to be prepared:

```bash
$ yarn # install all dependencies
$ yarn build # compile all contracts
```

In order to run all tests (including those with extra dependencies), run:

```bash
$ yarn test # run all tests
```

To instead run a single package's tests, run:

```bash
$ cd pkg/<package> # e.g. cd pkg/vault
$ yarn test
```

To run fuzz/invariant tests run:

```bash
$ cd pkg/<package> # e.g. cd pkg/safeguard-pool
$ yarn test-fuzz
```

## Security
### Audits
Swaap v2 SafeguardPool have been audited by Chainsecurity and Quantstamp. The audit reports can be found in the [`audits folder`](./audits/) of this repository.

### Upgradability

All core smart contracts are immutable, and cannot be upgraded.

## Licensing

Most of the Solidity source code is licensed under the GNU General Public License Version 3 (GPL v3): see [`LICENSE`](./LICENSE).

### Exceptions

- All files in the `openzeppelin` directory of the [`balancer-v2-solidity-utils`](./dep/solidity-utils) package are based on the [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) library, and as such are licensed under the MIT License: see [LICENSE](./dep/solidity-utils/contracts/openzeppelin/LICENSE).
- All other files, including tests and the [`pvt`](./pvt) directory are unlicensed.

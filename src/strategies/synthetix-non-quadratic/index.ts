import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { Contract } from '@ethersproject/contracts';
import { Provider } from '@ethersproject/providers';
import {
  subgraphRequest
  // ipfsGet
} from '../../utils';

export const author = 'andytcf';
export const version = '1.0.0';

type SNXHoldersResult = {
  snxholders: {
    id: string;
    initialDebtOwnership: BigNumber;
    debtEntryAtIndex: BigNumber;
  }[];
};

const HIGH_PRECISE_UNIT = 1e27;
const MED_PRECISE_UNIT = 1e18;
const SCALING_FACTOR = 1e5;

const DebtCacheABI = [
  {
    constant: true,
    inputs: [],
    name: 'currentDebt',
    outputs: [
      { internalType: 'uint256', name: 'debt', type: 'uint256' },
      { internalType: 'bool', name: 'anyRateIsInvalid', type: 'bool' }
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
];

const SynthetixStateABI = [
  {
    constant: true,
    inputs: [],
    name: 'lastDebtLedgerEntry',
    outputs: [{ name: '', type: 'uint256' }],
    payable: false,
    stateMutability: 'view',
    type: 'function'
  }
];

// @TODO: check if most-up-to-date version (using https://contracts.synthetix.io/SynthetixState)
const SynthetixStateContractAddress =
  '0x4b9Ca5607f1fF8019c1C6A3c2f0CC8de622D5B82';
// @TODO: check if most-up-to-date version (using http://contracts.synthetix.io/DebtCache)
const DebtCacheContractAddress = '0xe92B4c7428152052B0930c81F4c687a5F1A12292';

const defaultGraphs = {
  '1': 'https://api.thegraph.com/subgraphs/name/killerbyte/synthetix',
  '10':
    'https://api.thegraph.com/subgraphs/name/synthetixio-team/optimism-issuance'
};

// @TODO: update with the latest ovm snapshot
// const ovmSnapshotJSON = 'QmNwvhq4By1Mownjycg7bWSXqbJWMVyAWRZ1K4mjxuvGXg';

function returnGraphParams(snapshot: number | string, addresses: string[]) {
  return {
    snxholders: {
      __args: {
        where: {
          id_in: addresses.map((address: string) => address.toLowerCase())
        },
        first: 1000,
        block: {
          number: snapshot
        }
      },
      id: true,
      initialDebtOwnership: true,
      debtEntryAtIndex: true
    }
  };
}

const loadLastDebtLedgerEntry = async (
  provider: Provider,
  snapshot: number | string
) => {
  const contract = new Contract(
    SynthetixStateContractAddress,
    SynthetixStateABI,
    provider
  );

  const lastDebtLedgerEntry = await contract.lastDebtLedgerEntry({
    blockTag: snapshot
  });

  return BigNumber.from(lastDebtLedgerEntry);
};

const loadL1TotalDebt = async (
  provider: Provider,
  snapshot: number | string
) => {
  const contract = new Contract(
    DebtCacheContractAddress,
    DebtCacheABI,
    provider
  );

  const currentDebtObject = await contract.currentDebt({
    blockTag: snapshot
  });

  return Number(currentDebtObject.debt) / MED_PRECISE_UNIT;
};

const quadraticWeightedVoteL1 = async (
  initialDebtOwnership: BigNumber,
  debtEntryAtIndex: BigNumber,
  totalL1Debt: number,
  scaledTotalL2Debt: number,
  lastDebtLedgerEntry: BigNumber
) => {
  const currentDebtOwnershipPercent =
    (Number(lastDebtLedgerEntry) / Number(debtEntryAtIndex)) *
    Number(initialDebtOwnership);

  const highPrecisionBalance =
    totalL1Debt *
    MED_PRECISE_UNIT *
    (currentDebtOwnershipPercent / HIGH_PRECISE_UNIT);

  const currentDebtBalance = highPrecisionBalance / MED_PRECISE_UNIT;

  const totalDebtInSystem = totalL1Debt + scaledTotalL2Debt;

  const ownershipPercentOfTotalDebt = currentDebtBalance / totalDebtInSystem;

  const scaledWeighting = ownershipPercentOfTotalDebt * SCALING_FACTOR;

  return scaledWeighting;
};

const quadraticWeightedVoteL2 = async (
  initialDebtOwnership: BigNumber,
  debtEntryAtIndex: BigNumber,
  totalL1Debt: number,
  scaledTotalL2Debt: number,
  lastDebtLedgerEntryL2: number
) => {
  const currentDebtOwnershipPercent =
    (Number(lastDebtLedgerEntryL2) / Number(debtEntryAtIndex)) *
    Number(initialDebtOwnership);

  const highPrecisionBalance =
    totalL1Debt *
    MED_PRECISE_UNIT *
    (currentDebtOwnershipPercent / HIGH_PRECISE_UNIT);

  const currentDebtBalance = highPrecisionBalance / MED_PRECISE_UNIT;

  const totalDebtInSystem = totalL1Debt + scaledTotalL2Debt;

  const ownershipPercentOfTotalDebt = currentDebtBalance / totalDebtInSystem;

  const scaledWeighting = ownershipPercentOfTotalDebt * SCALING_FACTOR;

  return scaledWeighting;
};

export async function strategy(
  _space,
  _network,
  _provider,
  _addresses,
  _,
  snapshot
) {
  const score = {};
  const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';

  /* Global Constants */

  const totalL1Debt = await loadL1TotalDebt(_provider, snapshot); // (high-precision 1e18)
  const lastDebtLedgerEntry = await loadLastDebtLedgerEntry(
    _provider,
    snapshot
  );

  /* EDIT THESE FOR OVM */

  // @TODO update the currentDebt for the snapshot from (https://contracts.synthetix.io/ovm/DebtCache)
  const totalL2Debt = 22617610;
  // @TODO update the lastDebtLedgerEntry from (https://contracts.synthetix.io/ovm/SynthetixState)
  const lastDebtLedgerEntryL2 = 20222730523217499684984991;
  // @TODO update the comparison between OVM:ETH c-ratios at the time of snapshot
  const normalisedL2CRatio = 600 / 450;
  // @TODO update the L2 block number to use
  const L2BlockNumber = 1770186;

  const scaledTotalL2Debt = totalL2Debt * normalisedL2CRatio;

  /* --------------- */

  /* Using the subgraph, we get the relevant L1 calculations */

  const l1Results = (await subgraphRequest(
    defaultGraphs[1],
    returnGraphParams(blockTag, _addresses)
  )) as SNXHoldersResult;

  console.log(l1Results);

  if (l1Results && l1Results.snxholders) {
    for (let i = 0; i < l1Results.snxholders.length; i++) {
      const holder = l1Results.snxholders[i];
      const weightedVoteL1 = await quadraticWeightedVoteL1(
        holder.initialDebtOwnership,
        holder.debtEntryAtIndex,
        totalL1Debt,
        scaledTotalL2Debt,
        lastDebtLedgerEntry
      );
      console.log(weightedVoteL1);
      score[getAddress(holder.id)] = weightedVoteL1;
    }
  }

  /* Using the subgraph, we get the relevant L2 calculations */

  const l2Results = (await subgraphRequest(
    defaultGraphs[10],
    returnGraphParams(L2BlockNumber, _addresses)
  )) as SNXHoldersResult;

  // @notice fallback for when subgraph is down
  /* 
    const OVMSnapshot = await ipfsGet('gateway.pinata.cloud', ovmSnapshotJSON);
    const array = Object.assign(
      {},
      ...OVMSnapshot.data.snxholders.map((key) => ({
        [getAddress(key.id)]: {
        initialDebtOwnership: key.initialDebtOwnership,
        debtEntryAtIndex: key.debtEntryAtIndex
        }
      }))
    );
    for (let k = 0; k < _addresses.length; k++) {
      const address = _addresses[k];
      if (array[getAddress(address)]) {
        score[getAddress(address)] += await quadraticWeightedVoteL2(
          array[getAddress(address)].initialDebtOwnership,
          array[getAddress(address)].debtEntryAtIndex,
          totalL1Debt,
          scaledTotalL2Debt,
          lastDebtLedgerEntryL2
        );
      } else {
        continue;
      }
    }
  */

  if (l2Results && l2Results.snxholders) {
    for (let i = 0; i < l2Results.snxholders.length; i++) {
      const holder = l2Results.snxholders[i];

      const weightedVoteL2 = await quadraticWeightedVoteL2(
        holder.initialDebtOwnership,
        holder.debtEntryAtIndex,
        totalL1Debt,
        scaledTotalL2Debt,
        lastDebtLedgerEntryL2
      );

      if (score[getAddress(holder.id)]) {
        score[getAddress(holder.id)] += weightedVoteL2;
      } else {
        score[getAddress(holder.id)] = weightedVoteL2;
      }
    }
  }

  return score || {};
}

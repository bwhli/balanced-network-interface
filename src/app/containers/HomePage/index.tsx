import React from 'react';

import BigNumber from 'bignumber.js';
import { AccountType, BalancedJs } from 'packages/BalancedJs';
import { useIconReact } from 'packages/icon-react';
import { convertLoopToIcx } from 'packages/icon-react/utils';
import { Helmet } from 'react-helmet-async';
import styled from 'styled-components';
import { w3cwebsocket as W3CWebSocket } from 'websocket';

import CollateralPanel from 'app/components/home/CollateralPanel';
import LoanPanel from 'app/components/home/LoanPanel';
import PositionDetailPanel from 'app/components/home/PositionDetailPanel';
import RewardsPanel from 'app/components/home/RewardsPanel';
import WalletPanel from 'app/components/home/WalletPanel';
import { DefaultLayout } from 'app/components/Layout';
import bnJs from 'bnJs';
import useInterval from 'hooks/useInterval';
import { useChangeDepositedValue, useChangeBalanceValue } from 'store/collateral/hooks';
import { useLoanChangeBorrowedValue, useLoanChangebnUSDbadDebt, useLoanChangebnUSDtotalSupply } from 'store/loan/hooks';
import { useChangeRatio } from 'store/ratio/hooks';
import { useAllTransactions } from 'store/transactions/hooks';
import { useChangeWalletBalance } from 'store/wallet/hooks';

const Grid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-gap: 50px;
  margin-bottom: 50px;

  ${({ theme }) => theme.mediaWidth.upToSmall`
    grid-template-columns: 1fr;
  `}
`;

const PERIOD = 60 * 1000;

export function usePrice() {
  const changeRatioValue = useChangeRatio();

  // ICX / USD price
  useInterval(async () => {
    const res = await bnJs.Band.getReferenceData({ _base: 'ICX', _quote: 'USD' });
    const ICXUSDratio = convertLoopToIcx(res['rate']);
    changeRatioValue({ ICXUSDratio });
  }, PERIOD);

  // sICX / ICX price
  useInterval(async () => {
    const sICXICXratio = convertLoopToIcx(await bnJs.Staking.getTodayRate());
    changeRatioValue({ sICXICXratio });
  }, PERIOD);

  // BALN / bnUSD price
  // useInterval(async () => {
  //   const BALNbnUSDratio = convertLoopToIcx(await bnJs.Dex.getPrice(BalancedJs.utils.BALNbnUSDpoolId.toString()));
  //   changeRatioValue({ BALNbnUSDratio: BALNbnUSDratio });
  // }, PERIOD);

  // sICX / bnUSD price
  useInterval(async () => {
    const sICXbnUSDratio = convertLoopToIcx(await bnJs.Dex.getPrice(BalancedJs.utils.sICXbnUSDpoolId.toString()));
    changeRatioValue({ sICXbnUSDratio });
  }, PERIOD);
}

export function useBalance(account?: AccountType) {
  // eject this account and we don't need to account params for when call contract
  bnJs.eject({ account });

  const changeBalanceValue = useChangeWalletBalance();

  const changeRatioValue = useChangeRatio();

  const transactions = useAllTransactions();

  const fetchBalances = React.useCallback(() => {
    if (!account) return;

    Promise.all([bnJs.sICX.balanceOf(), bnJs.Baln.balanceOf(), bnJs.bnUSD.balanceOf(), bnJs.Rewards.getRewards()]).then(
      result => {
        const [sICXbalance, BALNbalance, bnUSDbalance, BALNreward] = result.map(v => convertLoopToIcx(v as BigNumber));
        changeBalanceValue({ sICXbalance });
        changeBalanceValue({ BALNbalance });
        changeBalanceValue({ bnUSDbalance });
        changeBalanceValue({ BALNreward });
      },
    );
  }, [account, changeBalanceValue]);

  const initWebSocket = React.useCallback(() => {
    if (!account) return;

    const client = new W3CWebSocket(`ws://localhost:8069/ws/address/${account}`);
    client.onopen = () => {
      client.send(
        JSON.stringify({
          address: account,
        }),
      );

      client.onmessage = (msgEvent: any) => {
        const data = JSON.parse(msgEvent.data);

        const { type, data: payload } = data;
        if (type === 'band_get_reference_data') {
          const { price } = payload;
          changeRatioValue({ ICXUSDratio: new BigNumber(price / 10 ** 18) });
        }

        if (type === 'MethodCall') {
          fetchBalances();
          alert(`https://bicon.tracker.solidwallet.io/transaction/${JSON.stringify(data, null, 2)}`);
        }
      };
    };
  }, [account, fetchBalances, changeRatioValue]);

  React.useEffect(() => {
    fetchBalances();
    initWebSocket();
  }, [fetchBalances, initWebSocket, transactions]);
}

export function useCollateralInfo(account?: string | null) {
  const changeStakedICXAmount = useChangeDepositedValue();
  const changeUnStackedICXAmount = useChangeBalanceValue();
  const transactions = useAllTransactions();

  const fetchCollateralInfo = React.useCallback(
    (account: string) => {
      Promise.all([
        bnJs.Loans.eject({ account }).getAccountPositions(),
        bnJs.contractSettings.provider.getBalance(account).execute(),
      ]).then(([stakedICXResult, balance]: Array<any>) => {
        const stakedICXVal = stakedICXResult['assets']
          ? convertLoopToIcx(new BigNumber(parseInt(stakedICXResult['assets']['sICX'], 16)))
          : new BigNumber(0);
        const unStakedVal = convertLoopToIcx(balance);

        changeStakedICXAmount(stakedICXVal);
        changeUnStackedICXAmount(unStakedVal);
      });
    },
    [changeUnStackedICXAmount, changeStakedICXAmount],
  );

  React.useEffect(() => {
    if (account) {
      fetchCollateralInfo(account);
    }
  }, [fetchCollateralInfo, account, transactions]);
}

export function useLoanInfo(account?: string | null) {
  const changeBorrowedValue = useLoanChangeBorrowedValue();
  const changebnUSDbadDebt = useLoanChangebnUSDbadDebt();
  const changebnUSDtotalSupply = useLoanChangebnUSDtotalSupply();

  const transactions = useAllTransactions();

  const fetchLoanInfo = React.useCallback(
    (account: string) => {
      if (account) {
        Promise.all([
          bnJs.Loans.eject({ account }).getAvailableAssets(),
          bnJs.bnUSD.totalSupply(),
          bnJs.Loans.eject({ account }).getAccountPositions(),
        ]).then(([resultGetAvailableAssets, resultbnUSDtotalSupply, resultbnUSDdebt]: Array<any>) => {
          const bnUSDbadDebt = convertLoopToIcx(resultGetAvailableAssets['bnUSD']['bad_debt']);
          const bnUSDtotalSupply = convertLoopToIcx(resultbnUSDtotalSupply);

          const bnUSDdebt = resultbnUSDdebt['assets']
            ? convertLoopToIcx(new BigNumber(parseInt(resultbnUSDdebt['assets']['bnUSD'] || 0, 16)))
            : new BigNumber(0);

          changebnUSDbadDebt(bnUSDbadDebt);
          changebnUSDtotalSupply(bnUSDtotalSupply);
          changeBorrowedValue(bnUSDdebt);
        });
      }
    },
    [changebnUSDbadDebt, changebnUSDtotalSupply, changeBorrowedValue],
  );

  React.useEffect(() => {
    if (account) {
      fetchLoanInfo(account);
    }
  }, [fetchLoanInfo, account, transactions]);
}

export function HomePage() {
  const { account } = useIconReact();

  usePrice();
  useBalance(account);
  useCollateralInfo(account);
  useLoanInfo(account);

  return (
    <DefaultLayout>
      <Helmet>
        <title>Home</title>
      </Helmet>

      <Grid>
        <CollateralPanel />

        <LoanPanel />

        <PositionDetailPanel />

        <WalletPanel />

        <div>
          <RewardsPanel />
        </div>
      </Grid>
    </DefaultLayout>
  );
}

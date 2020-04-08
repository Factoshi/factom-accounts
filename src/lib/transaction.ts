import { Transaction, TransactionAddress } from 'factom';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import axios from 'axios';

import { TransactionRow } from './types';
import { AddressConfig } from './types';
import { toInteger } from './utils';
import { TransactionTable } from './db';
import { logger } from './logger';
import { Factom } from './factom';

axiosRetry(axios, { retries: 2, retryDelay: exponentialDelay });

function formatIncomeTransaction(
    tx: Transaction,
    conf: AddressConfig,
    receivedFCT: number
): TransactionRow {
    return {
        address: conf.address,
        timestamp: toInteger(tx.timestamp / 1000),
        date: new Date(tx.timestamp).toISOString(),
        txhash: tx.id,
        height: tx.blockContext.directoryBlockHeight,
        symbol: 'FCT',
        currency: conf.currency,
        receivedFCT,
    };
}

function sumFCToutputs(transaction: Transaction, address: string) {
    // prettier-ignore
    return transaction.factoidOutputs
        .filter((outputs) => outputs.address === address)
        .reduce((total, current) => (total += current.amount), 0) * Math.pow(10, -8);
}

/**
 * Loops over past heights to fill in historical transaction data.
 */
export async function emitNewTransactions(
    db: TransactionTable,
    configStartHeight: number,
    factom: Factom
) {
    try {
        // Find the maximum processed height.
        const m = await db.getMaxHeight();
        // If the config start height is ahead of the DB, we'll use that instead.
        const startHeight = m > configStartHeight ? m : configStartHeight;
        // Find the height at the tip of the blockchain.
        const { directoryBlockHeight: stopHeight } = await factom.cli.getHeights();

        // Loop over missing heights.
        logger.info(`Fetching new tranactions between ${startHeight} and ${stopHeight}`);
        for (let i = startHeight + 1; i <= stopHeight; i++) {
            if (i % 1000 === 0) logger.info(`Scanning block height: ${i}`);

            const directoryBlock = await factom.cli.getDirectoryBlock(i);
            // Each directory block is fed into the event emitter. That will emit factoid transactions
            // for the addresses held in the config to be processed in the same manner as new found transactions.
            factom.event.handleDirectoryBlock(directoryBlock);
        }
        logger.info(`Scan complete`);
    } catch (e) {
        logger.error('Fatal error. Unable to backfill transactions: ', e);
        process.exit(1);
    }
}

/**
 * Saves all relevant transactions.
 * @param {AddressConfig} conf Config for a specific address.
 */
export function saveNewTransaction(conf: AddressConfig, db: TransactionTable, tx: Transaction) {
    const { address, coinbase, nonCoinbase } = conf;
    // Address may only record coinbase or non-coinbsae tranactions.
    const isCoinbase = tx.totalInputs === 0;
    if ((isCoinbase && !coinbase) || (!isCoinbase && !nonCoinbase)) {
        return;
    }

    const received = sumFCToutputs(tx, address);
    // Function only handles income transactions. If address did not received FCT then
    // it was not an income transaction.
    if (received === 0) {
        return;
    }

    const txRow = formatIncomeTransaction(tx, conf, received);

    // Save it to the database. This is a critical step and the programme will exit if it fails.
    try {
        logger.debug(
            `Saving new transaction for address ${txRow.address} at block ${txRow.height}`
        );
        return db.insertUncommittedTransaction(txRow);
    } catch (e) {
        logger.error(`Fatal error. Failed to save transaction to database: `, e);
        process.exit(1);
    }
}


"""Script to run large scale batches of tasks.

## Overview

An overview of the workflow (when running end-to-end):
1. Enqueue all files.
  - Artifacts created: output_dir/{input_file_name}_runs.csv
    This file is used to store the runs. Each file corresponds to one task group.
  - Note: Non validated files are not enqueued
2. Fetch all results.
  - Artifacts created: output_dir/results/{input_file_name}_results.csv and
    output_dir/runs/{input_file_name}_runs.csv
    The runs directory is used to store the results. Results for each input file is stored in
    the results directory at output_dir/{input_file_name}_runs.csv.
3. Merge results.
  - Artifacts created: output_dir/merged_results.csv
    This merges results from the input and output directories and combines them into a single file.
    The output columns will contain dictionary values that you will have to parse.

## Setup:
### Inputs:
- make sure that the input folder is defined
- if input size is >1k rows, split it into multiple files so that no file has more than 1k rows
- Each input file should be a valid csv.
- all input files should be in the same input directory
- Input files shouldn't end with the _tgrp_runs.csv suffix.
### Outputs:
- Make sure that the output directory has been created
### Environment variables
- PARALLEL_API_KEY is set as an environment variable.

## Dependencies:
- pandas
- parallel-web>=0.2.0

## Running the script

It is strongly recommended to start a dry run first to verify all inputs are correct.

To run, use: `python3 combined_script.py --input-dir <input_dir> --output-dir <output_dir> --processor <processor> --dry-run`
Once you don't receive any errors, remove the --dry-run flag and run again.
In case there are csv files that are not valid and are not fixable, you can skip them by adding the --skip-invalid flag.
"""

import os
from typing import Literal
import pandas as pd
from collections.abc import Iterator


import time
import argparse
import logging

import pandas as pd
from parallel import Parallel
from parallel.types import TaskRunJsonOutput
from typing import Any
import pandas as pd


from parallel.types.beta import BetaRunInputParam

#########################     UTILITY FUNCTIONS    #########################

class ValidationError(Exception):
    """Error raised when a file fails validation."""

    pass

class NonRetryableError(Exception):
    """Error raised when a file fails validation."""

    pass

def load_csv(file: str) -> pd.DataFrame:
    """Load a CSV file safely.
    
    Empty columns should not be treated as a float.
    """
    return pd.read_csv(file, na_filter=False)

def iter_files(input_dir: str) -> Iterator[str]:
    """Iterate over all files in a directory."""
    if not os.path.exists(input_dir):
        raise ValidationError(f"Directory {input_dir} does not exist.")
    file_found = False
    for file in os.listdir(input_dir):
        if file.endswith(".csv"):
            file_found = True
            yield os.path.join(input_dir, file)
    if not file_found:
        raise ValidationError(f"No CSV files found in {input_dir}.")

Stages = Literal["runs", "results"]

class FileManager:
    """Manages file names and paths for a given output directory."""

    def __init__(self, output_dir: str):
        self.output_dir = output_dir

    def output_file_path(self, input_filename: str, *, stage: Stages) -> str:
        """Get the output file path for a given input file and stage."""
        RUN_STATE_FILE_SUFFIX = "_tgrp_runs.csv"
        if input_filename.endswith(RUN_STATE_FILE_SUFFIX):
            input_filename = os.path.basename(input_filename).rstrip(RUN_STATE_FILE_SUFFIX)
        else:
            input_filename = os.path.basename(input_filename).rstrip(".csv")
        RESULT_STATE_FILE_SUFFIX = "_results.csv"
        subdir = stage
        if not os.path.exists(os.path.join(self.output_dir, subdir)):
            os.makedirs(os.path.join(self.output_dir, subdir))
        match stage:
            case "results":
                filename = f"{input_filename}{RESULT_STATE_FILE_SUFFIX}"
            case "runs":
                filename = f"{input_filename}{RUN_STATE_FILE_SUFFIX}"
        return os.path.join(self.output_dir, subdir, filename)


    @staticmethod
    def validate_file(file: str):
        """Validate a file."""
        if not os.path.exists(file):
            raise ValidationError(f"File {file} does not exist.")
        FILE_LENGTH_LIMIT = 1000
        try:
            input_df = pd.read_csv(file)
        except Exception as e:
            raise NonRetryableError(f"Incorrect csv file {file}: {e}")
        if len(input_df) > FILE_LENGTH_LIMIT:
            raise ValidationError(
                f"File {file} has more than {FILE_LENGTH_LIMIT} rows (len={len(input_df)})."
            )


    def already_enqueued(self, input_file_name: str) -> bool:
        """Check if a file has already been submitted for a run.

        This is proxied by the presence of a file in the output directory.
        """
        run_file_name = self.output_file_path(input_file_name, stage="runs")
        return  os.path.exists(run_file_name)


    def already_fetched(self, run_file_name: str) -> bool:
        """Check if a file has already been fetched.

        This is proxied by the presence of a file in the output directory.
        """
        result_file_name = self.output_file_path(run_file_name, stage="results")
        return os.path.exists(result_file_name)

    def get_output_dir(self, stage: Stages) -> str:
        """Get the output directory."""
        match stage:
            case "runs":
                return os.path.join(self.output_dir, "runs")
            case "results":
                return os.path.join(self.output_dir, "results")


#########################     Task configuration    #########################


OUTPUT_COLS = ["match_1", "match_2", "match_3", "match_4", "match_5"]

def build_task_spec(domains: list[str], source_rootdomain_name: str) -> dict[str, Any]:
    if len(domains) != len(OUTPUT_COLS):
        raise ValidationError(f"Number of domains ({len(domains)}) does not match number of output columns ({len(OUTPUT_COLS)})")

    return {
        "input_schema": {
            "json_schema": {
                "type": "object",
                "required": ["ManufacturerPartID", "SKU", "ManufacturerPartNumber", "OptionName", "UPC", "AdditionalUPC", "PrName", "ProductDescription", "MarketingCategory", "Class", "Manufacturer", "URL"],
                "properties": {
                    "ManufacturerPartID": {
                        "description": "Manufacturer part ID of the product to find matches for.",
                        "type": "string",
                    },
                    "SKU": {
                        "description": "SKU identifier of the product to find match for.",
                        "type": "string",
                    },
                    "ManufacturerPartNumber": {
                        "description": "Manufacturer part number (MPN) of the product to find matches for.",
                        "type": "string",
                    },
                    "OptionName": {
                        "description": "",
                        "type": "string",
                    },
                    "UPC": {
                        "description": "The UPC of the product to find matches for.",
                        "type": "string",
                    },
                    "AdditionalUPC": {
                        "description": "",
                        "type": "string",
                    },
                    "PrName": {
                        "description": "The name of the product to find matches for.",
                        "type": "string",
                    },
                    "ProductDescription": {
                        "description": "The description of the product to find matches for.",
                        "type": "string",
                    },
                    "MarketingCategory": {
                        "description": "The category of the product to find matches for.",
                        "type": "string",
                    },
                    "Class": {
                        "description": "The class of the product to find matches for.",
                        "type": "string",
                    },
                    "Manufacturer": {
                        "description": "Name of manufacturer of the product to find matches for.",
                        "type": "string",
                    },
                    "URL": {
                        "description": f"The direct URL to the {source_rootdomain_name} product page. Use this URL to first extract all the product details including manufacturer, part number, product name, specifications, dimensions, weight, price, etc. before matching.",
                        "type": "string",
                    }
                },
            }
        },
        "output_schema": {
            "json_schema": {
                "type": "object",
                "required": OUTPUT_COLS,
                "description": (
                    f"An exact match to the given product on target domains: {domains}. The match must have the same make and model -- i.e. the same manufacturer name and other details.\n"
                    "Matching Criteria (in order of priority):\n"
                    "1. **UPC (Universal Product Code) - Exact match** 2. **Manufacturer Part Number (MPN) - Exact match** 3. **Manufacturer Name** – Must match or be a known alias/brand variation 4. **Product Title/Option Name** – High similarity 5. **Product Class/Category** – Must be consistent 6. ** **Visual Match** (if available) – Product images should be visually identical "
                ),
                "properties": {
                    OUTPUT_COLS[i]: {
                        "description": f"The exact match to the original product on {domains[i]}.",
                        "properties": {
                            "product_url": {
                                "description": f"The direct URL of the matched {domains[i]} product page (must be from {domains[i]}). URL that is not from {domains[i]} is invalid and not considered a match. Must be a valid URL that opens up to the actual product page directly. If no match, return empty string.",
                                "type": "string",
                            },
                            "product_description": {
                                "description": f"The description of the matched {domains[i]} product page. If a description is not available, return 'Description unavailable.'. If no match, return empty string.",
                                "type": "string",
                            },
                            "product_price": {
                                "description": "The price of the matched product, including currency symbol (e.g., '$5.99'). If unavailable, return 'Price Not Available'. If no match, return empty string.",
                                "type": "string",
                            },
                            "product_in_stock": {
                                "description": "An indication whether the matched product is in-stock or not. If no match, return empty string.",
                                "enum": ["yes", "no", ""],
                                "type": "string",
                            }
                        },
                        "type": "object",
                    } for i in range(len(OUTPUT_COLS))
                },
            }
        },
    }

def create_run_payloads(
        chunk_df: pd.DataFrame, source_rootdomain_name: str, processor: str
) -> dict[str, BetaRunInputParam]:
    # Build inputs across domains
    run_map : dict[str, BetaRunInputParam] = {}
    for row in chunk_df.itertuples():
        row_domains = [row.competitor1, row.competitor2, row.competitor3, row.competitor4, row.competitor5]
        product_data = {
            "ManufacturerPartID": row.ManufacturerPartID,
            "SKU": row.SKU,
            "ManufacturerPartNumber": row.ManufacturerPartNumber,
            "OptionName": row.OptionName,
            "UPC": row.UPC,
            "AdditionalUPC": row.AdditionalUPC,
            "PrName": row.PrName,
            "ProductDescription": row.ProductDescription,
            "MarketingCategory": row.MarketingCategory,
            "Class": row.Class,
            "Manufacturer": row.Manufacturer,
            "URL": row.URL,
            "domains": row_domains
        }
        mpn_str = str(row.ManufacturerPartNumber)

        task_spec = build_task_spec(row_domains, source_rootdomain_name)
        run_map[mpn_str] = BetaRunInputParam(
            input=product_data,
            processor=processor,
            task_spec=task_spec,
            metadata={"manufacturerPartId": product_data.get("ManufacturerPartID", ""), "taskType": "match_search"},
            source_policy={"include_domains": row_domains},
        )

    return run_map

#########################    Execution script    #########################

# Flags
DRY_RUN = False
SKIP_INVALID = False
ENQUEUE_SLEEP_TIME = 5
FETCH_SLEEP_TIME = 60

SOURCE_ROOTDOMAIN_NAME = "Wayfair"

OUTPUT_DIR: str | None = None

# initialize logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# set the env variable PARALLEL_API_KEY or specify the api key explicitly
# via client = Parallel(api_key="your_api_key")
client = Parallel()

taskGroupIdCol = "TaskGroupID"
runIdCol = "RunId"
mergeIdCol = "ManufacturerPartNumber"

def enqueue_one(filepath: str, processor: str, file_manager: FileManager) -> bool:
    """Enqueue a file after validation. Wraps errors for retries."""
    try:
        return _enqueue_one(filepath, processor, file_manager)
    except ValidationError:
        raise
    except Exception as e:
        logger.error(f"Error enqueuing file {filepath}: {e}. Will retry.")
        return False

def _enqueue_one(filepath: str, processor: str, file_manager: FileManager) -> bool:
    """Enqueue a file after validation.

    Each file corresponds to one task group.
    """
    try:
        file_manager.validate_file(filepath)
    except NonRetryableError as e:
        if not SKIP_INVALID:
            raise ValidationError(f"File {filepath} failed .") from e
        logger.error(f"File {filepath} failed validation: {e}. It will be skipped.")
        return True
    except ValidationError as e:
        logger.error(f"File {filepath} failed validation: {e}")
        raise ValidationError("Files failed validation. Please check logs for more details.") from e
    input_df = load_csv(filepath)
    if DRY_RUN:
        logger.info(f"Skipping enqueue for file {filepath} due to dry run.")
        return True

    # enqueue
    input_map = create_run_payloads(input_df, SOURCE_ROOTDOMAIN_NAME, processor)
    tgroup = client.beta.task_group.create()
    run_responses = client.beta.task_group.add_runs(tgroup.task_group_id, inputs=[v for _,v in input_map.items()])

    # write to state file in output directory
    state_map: list[dict[str, str]] = []
    for i, run_key in enumerate(input_map):
        state_map.append({
            mergeIdCol: run_key,
            runIdCol: run_responses.run_ids[i],
            taskGroupIdCol: tgroup.task_group_id
        })

    logger.info(f"Processed file {filepath} with {len(state_map)} runs.")
    pd.DataFrame(state_map).to_csv(file_manager.output_file_path(filepath, stage="runs"), index=False)
    return True


def enqueue_all(input_dir: str, processor: str, file_manager: FileManager):
    """Enqueue all files in the input directory.

    Depending on the mode, it might raise an error.
    """
    logger.info("DRY RUN" if DRY_RUN else "Live Run")
    while True:
        all_completed = True
        for file in iter_files(input_dir):
            if file_manager.already_enqueued(file):
                logger.info(f"File {file} is already enqueued, skipping.")
                continue
            completed = enqueue_one(file, processor, file_manager)
            if not completed:
                all_completed = False

        if all_completed:
            logger.info("All files enqueued successfully.")
            break
        logger.info(f"Some files failed to enqueue. Waiting {ENQUEUE_SLEEP_TIME} seconds before retrying.")
        if DRY_RUN:
            logger.info("Breaking out of enqueue loop due to dry run.")
            break
        time.sleep(ENQUEUE_SLEEP_TIME)


def fetch_all(file_manager: FileManager):
    """Fetch all results from the output directory."""
    while True:
        all_completed = True
        for file in iter_files(file_manager.get_output_dir("runs")):
            if file_manager.already_fetched(file):
                logger.info(f"Results for file {file} already fetched, skipping")
                continue
            completed = fetch_one(file, file_manager)
            # heuristic to reduce poll count
            # early exit and sleep
            if not completed: # still active
                all_completed = False
                break
        if all_completed:
            break
        time.sleep(FETCH_SLEEP_TIME)



def fetch_one(run_file: str, file_manager: FileManager) -> bool:
    """Fetch a single result from the output directory. Wraps errors for retries."""
    try:
        logger.info(f"Fetching result from file {run_file}")
        return _fetch_one(run_file, file_manager)
    except Exception as e:
        logger.error(f"Error fetching result from file {run_file}: {e}")
        return False

def _fetch_one(run_file: str, file_manager: FileManager) -> bool:
    """Fetch a single result from the output directory.

    Poll until the task group is complete. Once it is finished, fetch the result.
    """
    run_df = load_csv(run_file)
    # each file has just one task group
    tgroup_id = str(run_df[taskGroupIdCol][0])
    tgroup = client.beta.task_group.retrieve(tgroup_id)
    if tgroup.status.is_active:
        logger.info(f"File {run_file} (Task group {tgroup_id}) is still active, skipping")
        return False
    results: list[dict[str, str]] = []
    for _, row in run_df.iterrows():
        run_id = str(row[runIdCol])
        result = None
        try:
            result = client.task_run.result(run_id)
        except Exception as e:
            # taskgroup is done, which means the run failed.
            logger.error(f"Run {run_id} in file {run_file} failed. Most likely failed. Error: {e}")
            continue
        if not isinstance(result.output, TaskRunJsonOutput):
            logger.error(f"Result for run {run_id} in file {run_file} is not a JSON output, skipping")
            continue

        results.append({
            mergeIdCol: str(row[mergeIdCol]),
            runIdCol: run_id,
            taskGroupIdCol: tgroup_id,
            **{OUTPUT_COLS[i]: result.output.content.get(OUTPUT_COLS[i], None) for i in range(len(OUTPUT_COLS))} # pyright: ignore[reportArgumentType]
        })
    pd.DataFrame(results).to_csv(file_manager.output_file_path(run_file, stage="results"), index=False)
    return True


def merge_results(input_dir: str, file_manager: FileManager):
    """Merge results from the input and output directory."""
    df_list: list[pd.DataFrame] = []
    for input_file in iter_files(input_dir):
        if not file_manager.already_fetched(input_file):
            logger.info(f"Results for file {input_file} not fetched, skipping for merge.")
            continue
        result_df = load_csv(file_manager.output_file_path(input_file, stage="results"))
        input_df = load_csv(input_file)
        print(file_manager.output_file_path(input_file, stage="results"))
        merged_df = pd.merge(input_df, result_df, on=mergeIdCol, how="left")
        df_list.append(merged_df)
    merged_df = pd.concat(df_list)
    merged_df.to_csv(file_manager.output_file_path("merged", stage="results"), index=False)

def run_batch(input_dir: str, output_dir: str, processor: str):
    """Run a batch of files in the input directory.

    This is a three step process:
    1. Enqueue all files in the input directory.
    2. Fetch results until complete.
    3. Merge results.

    This should be an idempotent operation, meaning that running it on the same input,
    should not incur any additional cost/time.
    """
    file_manager = FileManager(output_dir)
    enqueue_all(input_dir, processor, file_manager)
    if DRY_RUN:
        logger.info("Dry run complete.")
        return
    logger.info("Fetching results.")
    fetch_all(file_manager)
    logger.info("Merging results.")
    merge_results(input_dir, file_manager)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=str, required=True)
    parser.add_argument("--output-dir", type=str, required=True)
    parser.add_argument("--processor", type=str, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-invalid", action="store_true")
    args = parser.parse_args()
    
    if args.dry_run:
        DRY_RUN = True
    if args.skip_invalid:
        SKIP_INVALID = True
    run_batch(args.input_dir, args.output_dir, args.processor)


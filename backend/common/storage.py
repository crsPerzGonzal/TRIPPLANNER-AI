import os
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Key

from common.api import ApiError


def get_table():
    table_name = os.environ.get("TRIPPLANNER_TABLE")
    if not table_name:
        raise RuntimeError("Falta configurar TRIPPLANNER_TABLE.")

    import boto3

    return boto3.resource("dynamodb").Table(table_name)


def user_partition_key(user_id):
    return f"USER#{user_id}"


def get_item(table, user_id, sort_key):
    result = table.get_item(
        Key={"PK": user_partition_key(user_id), "SK": sort_key},
        ConsistentRead=True,
    )
    return result.get("Item")


def query_prefix(table, user_id, prefix):
    items = []
    query = {
        "KeyConditionExpression": Key("PK").eq(user_partition_key(user_id))
        & Key("SK").begins_with(prefix),
        "ConsistentRead": True,
    }

    while True:
        result = table.query(**query)
        items.extend(result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            return items
        query["ExclusiveStartKey"] = last_key


def put_item(table, item):
    table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
    )


def update_item(table, user_id, sort_key, updates):
    if not updates:
        raise ApiError(400, "EMPTY_UPDATE", "Indica al menos un campo para actualizar.")

    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    names = {f"#{field}": field for field in updates}
    values = {f":{field}": value for field, value in updates.items()}
    names["#updatedAt"] = "updatedAt"
    values[":updatedAt"] = timestamp
    assignments = [f"#{field} = :{field}" for field in updates]
    assignments.append("#updatedAt = :updatedAt")

    result = table.update_item(
        Key={"PK": user_partition_key(user_id), "SK": sort_key},
        UpdateExpression="SET " + ", ".join(assignments),
        ConditionExpression="attribute_exists(PK)",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes")


def now_timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

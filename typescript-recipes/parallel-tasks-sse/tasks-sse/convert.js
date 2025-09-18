/**
 * @typedef {Object} Citation
 * @property {string} [title] - Optional title of the citation
 * @property {string} url - URL of the citation
 * @property {string[]} [excerpts] - Optional excerpts from the citation
 */

/**
 * @typedef {Object} Node
 * @property {"string"|"number"|"boolean"|"null"|"array"|"object"} type - Type of the node
 * @property {Node[]|{[key: string]: Node}|string|number|boolean|null} value - Value of the node
 * @property {"low"|"medium"|"high"|null} confidence - Confidence level
 * @property {string} description - Description of the node
 * @property {Citation[]} citations - Array of citations
 * @property {string} reasoning - Reasoning behind the value
 */

/**
 * @typedef {Object} FieldBasis
 * @property {string} field - Field name
 * @property {Citation[]} citations - Citations for the field
 * @property {string} reasoning - Reasoning for the field
 * @property {"low"|"medium"|"high"|null} [confidence] - Confidence level
 */

/**
 * @typedef {Object} TaskRunResult
 * @property {*} run - TaskRun object
 * @property {Object} output - Output object
 * @property {FieldBasis[]} output.basis - Array of field basis information
 * @property {"json"|"text"} output.type - Type of output
 * @property {*} output.content - Content of the output
 * @property {*} [output.output_schema] - Optional output schema
 */

// ===== CONVERT NODE MODULE =====

/**
 * Converts a TaskRunResult to a Node structure
 * @param {TaskRunResult} result - The task run result to convert
 * @returns {Node} The converted node
 */
function convertResultToNode(result) {
  const { output } = result;

  // Create a basis lookup map for quick access
  const basisMap = new Map();
  output.basis.forEach((basis) => {
    basisMap.set(basis.field, basis);
  });

  // For text output, create a simple string node
  if (output.type === "text") {
    const basis = basisMap.get("output") || {
      field: "output",
      citations: [],
      reasoning: "Text output from task",
      confidence: null,
    };

    return {
      type: "string",
      value: output.content,
      confidence: basis.confidence || null,
      description: "Text output from the task",
      citations: basis.citations,
      reasoning: basis.reasoning,
    };
  }

  // For JSON output, recursively convert the content
  return convertValueToNode(
    output.content,
    basisMap,
    "", // root path
    output.output_schema,
    "Root object containing task output"
  );
}

/**
 * Converts a value to a Node recursively
 * @param {*} value - The value to convert
 * @param {Map<string, FieldBasis>} basisMap - Map of field basis information
 * @param {string} path - Current path in the object structure
 * @param {*} [schema] - Optional schema information
 * @param {string} [defaultDescription] - Default description if none available
 * @returns {Node} The converted node
 */
function convertValueToNode(
  value,
  basisMap,
  path,
  schema,
  defaultDescription = "No description available"
) {
  // Try multiple path variations to find basis information
  const possiblePaths = [
    path,
    path.split(".").pop() || "", // just the last segment
    path.replace(/\[(\d+)\]/g, ".$1"), // convert [0] to .0 notation
  ].filter((p) => p); // remove empty strings

  let basis;
  for (const possiblePath of possiblePaths) {
    basis = basisMap.get(possiblePath);
    if (basis) break;
  }

  // Extract description from schema if available
  let description = defaultDescription;
  if (schema) {
    description = schema.description || schema.title || defaultDescription;
  }

  // Override with basis reasoning if available and more descriptive
  if (basis?.reasoning && basis.reasoning.length > description.length) {
    description = basis.reasoning;
  }

  const baseNode = {
    confidence: basis?.confidence || null,
    description,
    citations: basis?.citations || [],
    reasoning: basis?.reasoning || "No reasoning provided",
  };

  if (value === null) {
    return {
      ...baseNode,
      type: "null",
      value: null,
    };
  }

  if (typeof value === "string") {
    return {
      ...baseNode,
      type: "string",
      value,
    };
  }

  if (typeof value === "number") {
    return {
      ...baseNode,
      type: "number",
      value,
    };
  }

  if (typeof value === "boolean") {
    return {
      ...baseNode,
      type: "boolean",
      value,
    };
  }

  if (Array.isArray(value)) {
    const arraySchema = schema?.items;
    return {
      ...baseNode,
      type: "array",
      value: value.map((item, index) => {
        // Use dot notation for array indices to match basis field format
        const arrayItemPath = path ? `${path}.${index}` : index.toString();
        return convertValueToNode(
          item,
          basisMap,
          arrayItemPath,
          arraySchema,
          `Array item at index ${index}`
        );
      }),
    };
  }

  if (typeof value === "object" && value !== null) {
    const objectValue = {};
    const objectSchema = schema?.properties || {};

    for (const [key, val] of Object.entries(value)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const fieldSchema = objectSchema[key];
      objectValue[key] = convertValueToNode(
        val,
        basisMap,
        fieldPath,
        fieldSchema,
        `Field: ${key}`
      );
    }

    return {
      ...baseNode,
      type: "object",
      value: objectValue,
    };
  }

  // Fallback for unknown types
  return {
    ...baseNode,
    type: "string",
    value: String(value),
  };
}

/**
 * Extracts the actual value from a Node structure
 * @param {Node} node - The node to extract value from
 * @returns {*} The extracted value
 */
function extractValue(node) {
  switch (node.type) {
    case "null":
    case "string":
    case "number":
    case "boolean":
      return node.value;
    case "array":
      return node.value.map(extractValue);
    case "object":
      const result = {};
      for (const [key, childNode] of Object.entries(node.value)) {
        result[key] = extractValue(childNode);
      }
      return result;
    default:
      return node.value;
  }
}

// ===== CONVERT TABLE MODULE =====

/**
 * Escapes HTML characters in text
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (typeof document === "undefined") return text;

  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 *
 * @param {Citation} citation
 * @returns {string}
 */
function getUrl(citation) {
  const { url, excerpts } = citation;

  if (!excerpts || excerpts.length === 0) {
    return url;
  }

  // Filter out empty excerpts and encode them for URL
  const validExcerpts = excerpts
    .filter((excerpt) => excerpt.trim().length > 0)
    .map((excerpt) => {
      const withoutDots = excerpt.endsWith("...")
        ? excerpt.slice(0, excerpt.length - 3)
        : excerpt;
      return encodeURIComponent(withoutDots.trim());
    });

  if (validExcerpts.length === 0) {
    return url;
  }

  // Use the scroll-to-text fragment syntax
  // Format: :~:text=excerpt1&text=excerpt2&text=excerpt3
  const textFragments = validExcerpts
    .map((excerpt) => `text=${excerpt}`)
    .join("&");

  return `${url}#:~:${textFragments}`;
}

/**
 * Creates a citation link HTML string
 * @param {Citation} citation - The citation object
 * @param {number} index - Index of the citation
 * @returns {string} HTML string for the citation link
 */
function createCitationLink(citation, index) {
  const title = citation.title ? escapeHtml(citation.title) : citation.url;
  return `<a href="${getUrl(citation)}" target="_blank" title="${title}">[${
    index + 1
  }]</a>`;
}

/**
 * Creates a confidence indicator HTML string
 * @param {"low"|"medium"|"high"|null} confidence - Confidence level
 * @param {string} reasoning - Reasoning text for tooltip
 * @returns {string} HTML string for confidence indicator
 */
function createConfidenceIndicator(confidence, reasoning) {
  if (!confidence) return "";

  const colors = {
    low: "#ff4444",
    medium: "#ffaa00",
    high: "#44ff44",
  };

  const color = colors[confidence];
  const escapedReasoning = escapeHtml(reasoning);

  return `<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${color}; margin-left: 5px;" title="${escapedReasoning}"></span>`;
}

/**
 * Converts a node to HTML table row content
 * @param {Node} node - The node to convert
 * @param {string} [key] - Optional key for the node
 * @returns {string} HTML string for the node
 */
function nodeToHtml(node, key) {
  const keyCell = key
    ? `<td style="font-weight: bold; vertical-align: top; padding: 4px 8px; border: 1px solid #ccc;" title="${escapeHtml(
        node.description
      )}">${escapeHtml(key)}</td>`
    : "";

  let valueCell = "";

  if (node.type === "array" && Array.isArray(node.value)) {
    const arrayTable = node.value
      .map((item, index) => `<tr>${nodeToHtml(item, index.toString())}</tr>`)
      .join("");

    valueCell = `<td style="vertical-align: top; padding: 4px 8px; border: 1px solid #ccc;">
      <table style="width: 100%; border-collapse: collapse;">
        ${arrayTable}
      </table>
    </td>`;
  } else if (
    node.type === "object" &&
    node.value &&
    typeof node.value === "object" &&
    !Array.isArray(node.value)
  ) {
    const objectTable = Object.entries(node.value)
      .map(([objKey, objNode]) => `<tr>${nodeToHtml(objNode, objKey)}</tr>`)
      .join("");

    valueCell = `<td style="vertical-align: top; padding: 4px 8px; border: 1px solid #ccc;">
      <table style="width: 100%; border-collapse: collapse;">
        ${objectTable}
      </table>
    </td>`;
  } else {
    // Primitive value
    let displayValue = "";
    if (node.value === null) {
      displayValue = "null";
    } else if (typeof node.value === "string") {
      displayValue = escapeHtml(node.value);
    } else {
      displayValue = String(node.value);
    }

    const citations =
      node.citations.length > 0
        ? " " +
          node.citations
            .map((citation, index) => createCitationLink(citation, index))
            .join(" ")
        : "";

    const confidenceIndicator = createConfidenceIndicator(
      node.confidence,
      node.reasoning
    );

    valueCell = `<td style="vertical-align: top; padding: 4px 8px; border: 1px solid #ccc;">${displayValue}${citations}${confidenceIndicator}</td>`;
  }

  return key ? `${keyCell}${valueCell}` : valueCell;
}

/**
 * Converts a node to an HTML table
 * @param {Node} rootNode - The root node to convert
 * @returns {string} HTML table string
 */
function nodeToTable(rootNode) {
  if (
    rootNode.type === "object" &&
    rootNode.value &&
    typeof rootNode.value === "object" &&
    !Array.isArray(rootNode.value)
  ) {
    const rows = Object.entries(rootNode.value)
      .map(([key, node]) => `<tr>${nodeToHtml(node, key)}</tr>`)
      .join("");

    return `<table style="border-collapse: collapse; width: 100%;">${rows}</table>`;
  } else if (rootNode.type === "array" && Array.isArray(rootNode.value)) {
    const rows = rootNode.value
      .map((node, index) => `<tr>${nodeToHtml(node, index.toString())}</tr>`)
      .join("");

    return `<table style="border-collapse: collapse; width: 100%;">${rows}</table>`;
  } else {
    // Single value at root
    return `<table style="border-collapse: collapse; width: 100%;"><tr>${nodeToHtml(
      rootNode,
      "value"
    )}</tr></table>`;
  }
}

// ===== CONVERT URL FUNCTION =====

/**
 * HTML template for displaying the converted data
 * @param {string} tableHtml - The HTML table content
 * @param {string} url - The original URL
 * @returns {string} Complete HTML document
 */
function createHtmlTemplate(tableHtml, url) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Result Viewer</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: #007bff;
            color: white;
            padding: 20px;
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 24px;
        }
        .header p {
            margin: 0;
            opacity: 0.9;
            font-size: 14px;
        }
        .content {
            padding: 20px;
        }
        table {
            font-size: 14px;
            line-height: 1.4;
        }
        table td {
            word-wrap: break-word;
            max-width: 300px;
        }
        .legend {
            margin-bottom: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 4px;
            border-left: 4px solid #007bff;
        }
        .legend h3 {
            margin: 0 0 10px 0;
            font-size: 16px;
        }
        .confidence-item {
            display: inline-block;
            margin-right: 20px;
            margin-bottom: 5px;
        }
        .confidence-dot {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 5px;
            vertical-align: middle;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Task Result Viewer</h1>
            <p>Source: ${escapeHtml(url)}</p>
        </div>
        <div class="content">
            <div class="legend">
                <h3>Confidence Legend</h3>
                <div class="confidence-item">
                    <span class="confidence-dot" style="background-color: #44ff44;"></span>
                    High Confidence
                </div>
                <div class="confidence-item">
                    <span class="confidence-dot" style="background-color: #ffaa00;"></span>
                    Medium Confidence
                </div>
                <div class="confidence-item">
                    <span class="confidence-dot" style="background-color: #ff4444;"></span>
                    Low Confidence
                </div>
            </div>
            ${tableHtml}
        </div>
    </div>
</body>
</html>`;
}

/**
 * Fetches a URL, converts the task result to a node, generates HTML, and opens it in a new window
 * @param {string} url - The URL to fetch
 * @returns {Promise<void>} Promise that resolves when the operation is complete
 */
async function convertUrl(url) {
  try {
    console.log(`Fetching data from: ${url}`);

    // Fetch the data from the URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Fetched data:", data);

    // Extract the task result
    const taskResult = data.task?.result;
    if (!taskResult) {
      throw new Error("No task.result found in the response");
    }

    console.log("Task result:", taskResult);

    // Convert to node
    const node = convertResultToNode(taskResult);
    console.log("Converted node:", node);

    // Generate HTML table
    const tableHtml = nodeToTable(node);
    console.log("Generated table HTML");

    // Create complete HTML document
    const fullHtml = createHtmlTemplate(tableHtml, url);

    // Open in new window
    const newWindow = window.open("", "_blank");
    if (newWindow) {
      newWindow.document.write(fullHtml);
      newWindow.document.close();
      console.log("Opened result in new window");
    } else {
      console.error("Failed to open new window - popup blocked?");
      // Fallback: create a blob URL and try to open it
      const blob = new Blob([fullHtml], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
    }
  } catch (error) {
    console.error("Error in convertUrl:", error);
    alert(`Error converting URL: ${error.message}`);
  }
}

// Export functions for use
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    convertResultToNode,
    convertValueToNode,
    extractValue,
    nodeToTable,
    convertUrl,
  };
}

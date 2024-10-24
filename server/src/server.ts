/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection,
	TextDocuments,
	// Diagnostic,
	// DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline'
import { exec } from 'child_process';

import {
	Position,
	TextDocument
} from 'vscode-languageserver-textdocument';
import { Definition, DidSaveTextDocumentParams, Location, SignatureHelpParams} from 'vscode-languageserver';
// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

var workspaceFolders = "";
var functionTable: any[] = [];
var structTable: any[] = [];
var defineTable: any[] = [];
var memberTable: any[] = [];
var varriTable: any[] = [];
var typeTable: any[] = [];
var tmpHelp: any = null;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;
	console.log(hasDiagnosticRelatedInformationCapability);

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability =
		!!capabilities.workspace && !!capabilities.workspace.configuration;
	hasWorkspaceFolderCapability =
		!!capabilities.workspace && !!capabilities.workspace.workspaceFolders;
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation);

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: false
			},
			signatureHelpProvider: {
				triggerCharacters: ['('],
				retriggerCharacters: [',', ')', ';'],
			},
			definitionProvider: true,
			referencesProvider: true,
			hoverProvider: true,
		}
	};
});
connection.onInitialized(() => {
	connection.console.log('Server initialized');
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(
			DidChangeConfigurationNotification.type,
			undefined
		);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
	connection.workspace.getWorkspaceFolders().then((folders) => {
		if (folders) {
			folders.forEach(folder => {
			  // Convert URI to file path
			  const workspaceFolderPath = URI.parse(folder.uri).fsPath;
			  const tagsFilePath = path.join(workspaceFolderPath, 'tags');
			  workspaceFolders = workspaceFolderPath;
			  return;
		try {
			console.log(tagsFilePath);
			const readInterface = readline.createInterface({
				input: fs.createReadStream(tagsFilePath),
				output: process.stdout
			});
		
			  readInterface.on('line', (line) => {
							if (line.trim() === '') return;  // Skip empty lines
							line = line.trim(); 
							// Split the line into components
							const parts = line.match(/^([^\t]+)\t([^\t]+)\t\/\^(.+?)(?:\$\/;"|\/;")(.*)$/);
							if (!parts) {
								return;
							}
							if (parts.length < 5) {
								return;
							}

							const symbol = parts[1].trim();
							const filePath = parts[2];
							const definition = parts[3];
							const additionalParts = parts[4].split('\t');
							var match, typename, struct;

							const type = additionalParts[1];
							if (type === 'm')
							{
								match = additionalParts[2].match(/struct:(\w+)/);
								struct = match ? match[1] : null;
								// match = additionalParts[3].match(/typeref:typename:(.*)/);
								// typename = match ? match[1] : null;
							}
							else if (type === 't')
							{
								match = additionalParts[2] ? additionalParts[2].match(/typeref:(.*)/) : null;
								typename = match ? match[1] : null;
							}
							else
							{
								match = additionalParts[2] ? additionalParts[2].match(/typeref:typename:(.*)/) : null;
								typename = match ? match[1] : null;
							}
							const local = parts[4].includes("file:");

							switch (type) {
								case 'f':
									functionTable.push({
										symbol: symbol,
										filePath: filePath,
										definition: definition,
										typename: typename,
									});
									break;
								case 's':
									structTable.push({
										symbol: symbol,
										filePath: filePath,
										definition: definition,
										typename: typename,
									});
									break;
								case 'd':
								case 'e':
									defineTable.push({
										symbol: symbol,
										filePath: filePath,
										definition: definition,
									});
									break;
								case 'm':
									memberTable.push({
										symbol: symbol,
										filePath: filePath,
										definition: definition,
										struct: struct,
										// typename: typename,
									});
									break;
								case 'v':
									varriTable.push({
										symbol: symbol,
										filePath: filePath,
										definition: definition,
										typename: typename,
										local: local,
									});
								case 't':
									typeTable.push({
										symbol: symbol,
										filePath: filePath,
										definition: definition,
										typename: typename,
									});
									break;
							}
						});
					} catch (error) {
						connection.console.log(String(error));
					}
				});
		} else {
			console.log("No workspace folders are open.");
		}
	});
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
// const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
// let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

// connection.onDidChangeConfiguration(change => {
// 	if (hasConfigurationCapability) {
// 		// Reset all cached document settings
// 		documentSettings.clear();
// 	} else {
// 		globalSettings = <ExampleSettings>(
// 			(change.settings.languageServerExample || defaultSettings)
// 		);
// 	}

// 	// Revalidate all open text documents
// 	documents.all().forEach(validateTextDocument);
// });

// function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
// 	if (!hasConfigurationCapability) {
// 		return Promise.resolve(globalSettings);
// 	}
// 	let result = documentSettings.get(resource);
// 	if (!result) {
// 		result = connection.workspace.getConfiguration({
// 			scopeUri: resource,
// 			section: 'languageServerExample'
// 		});
// 		documentSettings.set(resource, result);
// 	}
// 	return result;
// }

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidSave(change => {
  let fileUri = URI.parse(change.document.uri).fsPath;
//   let tmpWorkspaceFolders = workspaceFolders.slice(3);
  let filePath = fileUri.slice(workspaceFolders.length + 1);
	const command = `gtags --single-update ${filePath}`;
	const process = exec(command, (error, stdout, stderr) => {
		if (error) {
			connection.console.error(`Error: ${error.message}`);
			return;
		}
		if (stderr) {
			connection.console.error(`Stderr: ${stderr}`);
			return;
		}
		return;
		console.log(stdout);
	});
	const timeout = setTimeout(() => {
		process.kill();
	}, 10000);
	process.on('exit', () => {
		clearTimeout(timeout);
	});
});

// async function validateTextDocument(textDocument: TextDocument): Promise<void> {
// 	// In this simple example we get the settings for every validate run.
// 	const settings = await getDocumentSettings(textDocument.uri);

// 	// The validator creates diagnostics for all uppercase words length 2 and more
// 	const text = textDocument.getText();
// 	const pattern = /\b[A-Z]{2,}\b/g;
// 	let m: RegExpExecArray | null;

// 	let problems = 0;
// 	const diagnostics: Diagnostic[] = [];
// 	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
// 		problems++;
// 		const diagnostic: Diagnostic = {
// 			severity: DiagnosticSeverity.Warning,
// 			range: {
// 				start: textDocument.positionAt(m.index),
// 				end: textDocument.positionAt(m.index + m[0].length)
// 			},
// 			message: `${m[0]} is all uppercase.`,
// 			source: 'ex'
// 		};
// 		if (hasDiagnosticRelatedInformationCapability) {
// 			diagnostic.relatedInformation = [
// 				{
// 					location: {
// 						uri: textDocument.uri,
// 						range: Object.assign({}, diagnostic.range)
// 					},
// 					message: 'Spelling matters'
// 				},
// 				{
// 					location: {
// 						uri: textDocument.uri,
// 						range: Object.assign({}, diagnostic.range)
// 					},
// 					message: 'Particularly for names'
// 				}
// 			];
// 		}
// 		diagnostics.push(diagnostic);
// 	}

// 	// Send the computed diagnostics to VSCode.
// 	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
// }

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received a file change event');
});

// This handler provides the initial list of the completion items.
function getCompletionItems(symbol: string): Promise<CompletionItem[]> {
	const command = `global -c ${symbol}`;
	console.log(symbol);
	return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                return reject(`Error: ${error.message}`);
            }
            if (stderr) {
                return reject(`Stderr: ${stderr}`);
            }

            const completions: CompletionItem[] = [];
			// Tách các dòng kết quả và xử lý từng dòng
			const lines = stdout.split('\n').filter(line => line.trim() !== '');
			lines.forEach(line => {
				const completionItem: CompletionItem = {
					label: line,
					kind: CompletionItemKind.Function,
					data: 1
				};
				completions.push(completionItem);
			}
			);


            resolve(completions);
        });
    });
}

connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
	  // Get the text document
	const document = documents.get(textDocumentPosition.textDocument.uri);
	if (!document) {
		return [];
	}
	const word = getWordAtPosition(document, textDocumentPosition.position);
	const completions = await getCompletionItems(word); // Await the getCompletionItems function
	return completions; // Return the resolved value
	}
  );
  connection.onSignatureHelp(
	async (_signatureParams: SignatureHelpParams) => {

		if (_signatureParams.context && _signatureParams.context.isRetrigger) {
			if (tmpHelp && _signatureParams.context.triggerCharacter === ',') {
				tmpHelp.activeParameter += 1;
			}
			else if (tmpHelp && _signatureParams.context.triggerCharacter === ')' || _signatureParams.context.triggerCharacter === ';') {
				tmpHelp = null;
			}
			return tmpHelp;
		}
		const document = documents.get(_signatureParams.textDocument.uri);
		if (!document) {
			return null;
		}
		let position = _signatureParams.position;
		position.character -= 1;
		const word = getWordAtPosition(document, position);
		const results = await runGlobalDefine(word, true);
		if (results.length === 1)
		{
			let parameter = results[0].definition.split("(")[1].split(")")[0].split(",");
			tmpHelp = {
				signatures: [
				{
					label: results[0].definition,
					documentation: 'Function description',
					parameters: parameter.map((param) => {
						return {
							label: param.trim(),
						};
					})
				}],
				activeSignature: 0,
				activeParameter: 0 // Set this to track which parameter the user is currently typing
			};
			return tmpHelp;
		}
	
	  return null;
	}
  );
function getBestResult(uri : string, result: GlobalResult[]) {
	let bestResult = result[0];
	let bestDistance = Number.MAX_VALUE;
	const currentPath = URI.parse(uri).fsPath;
	for (const res of result) {
		const filePath = res.filePath;
		const distance = path.relative(currentPath, filePath).length;
		if (distance < bestDistance) {
			bestDistance = distance;
			bestResult = res;
		}
	}
	return bestResult;
}
  connection.onHover(
	async (hoverParams: TextDocumentPositionParams) => {
		// Lấy tài liệu hiện tại từ vị trí con trỏ
		const document = documents.get(hoverParams.textDocument.uri);
		if (!document) {
			return null;
		}

		// Lấy vị trí của con trỏ
		const position = hoverParams.position;
		const word = getWordAtPosition(document, position);
		console.log(`Hovering over: ${word}`);

		// Tìm định nghĩa của từ khóa/hàm
		const results = await runGlobalDefine(word, true);
		if (results.length > 0) {
			// Hiển thị kết quả tìm thấy
			const bestResult = getBestResult(hoverParams.textDocument.uri, results);
			return {
				contents: {
					kind: 'markdown',
					value: `**Definition**: \n\`\`\`c\n${bestResult.definition}\n'At ${bestResult.filePath}:${bestResult.lineNumber}\n'There are ${results.length - 1} other definitions'\n\`\`\``
				},
				range: {
					start: { line: position.line, character: position.character },
					end: { line: position.line, character: position.character + word.length }
				}
			};
		}

		// Nếu không tìm thấy thông tin, trả về null
		return null;
	}
);
function getWordAtPosition(document: TextDocument, position: Position): string {
	const offset = document.offsetAt(position);
	const text = document.getText();
	const wordMatch = /\b(\w+)\b/g;
	let match: RegExpExecArray | null;
  
	while ((match = wordMatch.exec(text)) !== null) {
	  const start = match.index;
	  const end = start + match[0].length;
  
	  if (start <= offset && offset <= end) {
		return match[0];
	  }
	}
  
	return '';
  }
function getSymbolType(symbol: string, code: string) {
	// Regular expression to detect function calls
	var regex = new RegExp(`\\b${symbol}\\s*\\(`);
	const escapedKeyword = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
	if (regex.test(code))
	{
		return "f";
	}
	// Regular expression to detect struct by find "struct" keyword
	regex = new RegExp(`\\bstruct\\s+${symbol}\\b`);
	if (regex.test(code))
	{
		return "s";
	}

	// Regular expression to detect define by detect all uppercase
	regex = new RegExp(`^[a-zA-Z0-9_\\s]+.*\\b${escapedKeyword}\\b[^"()]*[,;]?\\s*$`, 'gm');
	if (regex.test(code.trim()))
	{
		let tmp = code.split(symbol)[0].trim();
		if (tmp.length === 0 || tmp.includes("const") || tmp.includes("static") || tmp.includes("extern"))
			return "t";
	}
	if (symbol === symbol.toUpperCase())
	{
		return "d";
	}
	// Regular expression to detect member by find "." or "->" keyword
	regex = new RegExp(`(\\.|->)${symbol}\\b`);
	if (regex.test(code))
	{
		return "m";
	}
	return "v";
}

async function readFileContent(filePath: string): Promise<string> {
    const fs = require('fs').promises;
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        console.error(`Failed to read file at ${filePath}:`, error);
        return '';
    }
}

// Function to find the symbol's position in the file content
function findSymbolPosition(fileContent: string, symbol: string): { line: number, character: number } | null {
    const lines = fileContent.split('\n');
    for (let line = 0; line < lines.length; line++) {
        const character = lines[line].indexOf(symbol);
        if (character !== -1) {
            return { line, character };
        }
    }
    return null;
}
async function findDefinition(symbol: string, list: any[], data : string[] = []) {
	const definitions = list.filter((func) => func.symbol.trim() === symbol);
		const locations: Location[] = [];
		console.log(data);
		
		for (const definition of definitions) {

			// Read the file content
			const filePath = definition.filePath;
			const fileContent = await readFileContent(filePath);
			
			// Find the symbol's position in the file content
			const position = findSymbolPosition(fileContent, definition.definition);
			if (position) {
				console.log(definition);
				if (data.length > 0)
				{
					data.forEach((d) => {
						if (definition.struct.includes(d))
						{
							locations.push({
								uri: URI.file(workspaceFolders +'/' +filePath).toString(),
								range: {
									start: { line: position.line, character: position.character },
									end: { line: position.line, character: position.character + definition.symbol.length }
								}
							});
						}
					});

				}
				else
				{
					locations.push({
						uri: URI.file(workspaceFolders +'/' +filePath).toString(),
						range: {
							start: { line: position.line, character: position.character },
							end: { line: position.line, character: position.character + definition.symbol.length }
						}
					});
				}
			}
		}
		return locations;
}
function matchesIntOrCharWithExactKeyword(keyword: string, str: string) {
    // Escaping the keyword for use in regex
	
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
    
    // const regex = new RegExp(`^\\s*(int|char|double|float|long|short|unsigned|struct)\\b.*\\b${escapedKeyword}\\b.*$`, 'gm');
	const regex = new RegExp(`^[a-zA-Z0-9_\\s]+\\s+.*\\b${escapedKeyword}\\b[^"()]*[,;]?\\s*$`, 'gm');
    
    // Use the match method with the regex
    const matches = [...str.matchAll(regex)];
    
    // Extracting line numbers and keyword positions
    const results = matches.map(match => {
        const line = match[0]; // Full matched line
        const lineNumber = str.substr(0, match.index).split('\n').length;
        const keywordIndex = line.indexOf(keyword); // Index of keyword within the line
		const lineContent = line.trim();
		if (regex.test(lineContent))
		{
			return {
				lineNumber: lineNumber,
				keywordIndex: keywordIndex
			};
		}
		else
		{
			return {
				lineNumber: -1,
				keywordIndex: -1
			};
		}
    });
	//if lineNumber == -1 remove it.
	results.forEach((pos, index) => {
		if (pos.lineNumber === -1)
		{
			results.splice(index, 1);
		}
	});

    return results;
}
function getStructOfMember(word: string, document: TextDocument, lineContent: string)
{
	var regex = new RegExp(`(\\w+)\\s*(\\.|-\\>)\\s*${word}`);
	var match = lineContent.match(regex);
	var struct = "";
	const results: string[] = [];

	if (match) {
		struct = match[1];
		
		console.log(struct);
		const structLine = matchesIntOrCharWithExactKeyword(struct, document.getText());
		console.log(structLine);
		structLine.forEach((pos) => {
			const lineRange = { start: { line: pos.lineNumber, character: 0 }, end: { line: pos.lineNumber + 1, character: 0 } };
			const structLineContent = document.getText(lineRange).trim();
			console.log(structLineContent);
			regex = new RegExp(`struct\\s+(\\w+)\\s+(\\*?${struct})`);
			match = structLineContent.match(regex);
			if(match)
				results.push(match[1]);
		});
	}
	return results;
}
interface GlobalResult {
    filePath: string;
    lineNumber: string;
	definition: string;
}
function runGlobalDefine(symbol: string, isDefinetion: boolean): Promise<GlobalResult[]> {
	/* check symbol is speccial character*/
	if (symbol.match(/[^a-zA-Z0-9_]/) || symbol === '' || symbol === ' ')
	{
		return Promise.resolve([]);
	}
    var command = isDefinetion ? `global -x -M -d ${symbol}` : `global -x -M -r ${symbol}`;
    return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                return resolve([]); // Ignore errors
            }
            if (stderr) {
                return resolve([]); // Ignore errors
            }

            const results: GlobalResult[] = [];
            // Tách các dòng kết quả và xử lý từng dòng
            const lines = stdout.split('\n').filter(line => line.trim() !== '');
            lines.forEach(line => {
                const parts = line.split(/\s+/);
                if (parts.length >= 3) {
                    const lineNumber = parts[1];  // Số dòng
                    const filePath = parts[2];  // Đường dẫn tệp
					const definition = line.slice(line.indexOf(filePath) + filePath.length).trim();
                    results.push({ filePath, lineNumber, definition});
                }
            });

            resolve(results);
        });
    });
}
/* find symbol by run command global -x -M -d ${symbol} */
async function findDefinitionReferenceByGlobalTag(symbol: string, isDefinetion: boolean) {
	const locations: Location[] = [];
	const results = await runGlobalDefine(symbol, isDefinetion);
	results.forEach(result => {
		const position = { line: parseInt(result.lineNumber) - 1, character: 0 };
		locations.push({
			uri: URI.file(workspaceFolders +'/' + result.filePath).toString(),
			range: {
				start: position,
				end: position
			}
		});
	});
	return locations;
}
connection.onDefinition(
    async (textDocumentPosition: TextDocumentPositionParams): Promise<Definition> => {
        // Get the text document
        const document = documents.get(textDocumentPosition.textDocument.uri);
		let positions: Location[] = [];
		const lineNumber = textDocumentPosition.position.line;
		const lineRange = { start: { line: lineNumber, character: 0 }, end: { line: lineNumber + 1, character: 0 } };
        
        // Check if the document exists
        if (!document) {
			return [];
        }
		
        // Get the word under the cursor
		const lineContent = document.getText(lineRange);
        const word = getWordAtPosition(document, textDocumentPosition.position);
		const wordType = getSymbolType(word, lineContent);
		let list = functionTable;
        switch (wordType) {
			case 'f':
				list = functionTable;
				break;
			case 's':
				list = structTable;
				break;
			case 'd':
				list = defineTable;
				break;
			case 'm':
				list = memberTable;
				break;
			case 't':
				list = typeTable;
				break;
			case 'v':
				const variablePositions = matchesIntOrCharWithExactKeyword(word, document.getText());
				console.log(variablePositions);
				if (variablePositions.length != 0 && variablePositions[0].lineNumber != -1)
				{
					// positions = variablePositions.map(pos => ({
					// 	uri: textDocumentPosition.textDocument.uri,
					// 	range: {
					// 		start: { line: pos.lineNumber, character: pos.keywordIndex },
					// 		end: { line: pos.lineNumber, character: pos.keywordIndex + word.length }
					// 	}
					// }));
					// list = undefined;
				}
				else
				{
					list = varriTable;
				}
				break;
		}
		// Find all the function definitions
		if (list === undefined)
		{
			return positions;
		}
		console.log(word);
		positions = await findDefinitionReferenceByGlobalTag(word, true);
		console.log(positions);
		if (positions.length === 0)
		{
			positions = await findDefinition(word, list, wordType === 'm' ? getStructOfMember(word, document, lineContent) : []);
		}

		return positions;
    }
);
connection.onReferences(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<Location[]> => {
        const document = documents.get(textDocumentPosition.textDocument.uri);
		let positions: Location[] = [];
		if (!document) {
			return [];
		}
		const word = getWordAtPosition(document, textDocumentPosition.position);
		console.log(word);
		positions = await findDefinitionReferenceByGlobalTag(word, false);
		console.log(positions);
		return positions;
	}
)
connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
	const filePath = params.textDocument.uri;
	const command = `gtags --single-update ${filePath}`;
	exec(command, (error, stdout, stderr) => {
		if (error) {
			connection.console.error(`Error: ${error.message}`);
			return;
		}
		if (stderr) {
			connection.console.error(`Stderr: ${stderr}`);
			return;
		}
		return;
		console.log(stdout);
	});
});


/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

using Lilja.MasterData.GeneratedBuilder;

if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: Lilja.MasterData.GeneratedBuilder <build-input.json>");
    return 2;
}

var inputPath = Path.GetFullPath(args[0]);
var input = BuildInput.Load(inputPath);
var outputPath = Path.GetFullPath(input.OutputPath);

Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
MasterMemoryBinaryBuilder.Build(input, outputPath);

return 0;

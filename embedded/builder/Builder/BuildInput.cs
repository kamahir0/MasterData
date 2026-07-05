using System.Text.Json;
using System.Text.Json.Nodes;

namespace MasterData.GeneratedBuilder;

public sealed class BuildInput
{
    public required string Namespace { get; init; }
    public required string OutputPath { get; init; }
    public required List<BuildTable> Tables { get; init; }

    public static BuildInput Load(string path)
    {
        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        var input = JsonSerializer.Deserialize<BuildInput>(File.ReadAllText(path), options);
        return input ?? throw new InvalidOperationException($"Build input was empty: {path}");
    }
}

public sealed class BuildTable
{
    public required string TableName { get; init; }
    public required string TypeName { get; init; }
    public required string FullTypeName { get; init; }
    public required List<BuildField> Fields { get; init; }
    public required List<Dictionary<string, JsonNode?>> Rows { get; init; }
}

public sealed class BuildField
{
    public required string Name { get; init; }
    public required string Type { get; init; }
}


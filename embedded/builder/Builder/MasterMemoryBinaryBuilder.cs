using System.Collections;
using System.Collections.Immutable;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using MasterMemory;

namespace MasterData.GeneratedBuilder;

public static class MasterMemoryBinaryBuilder
{
    public static void Build(BuildInput input, string outputPath)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var databaseBuilderType = assembly.GetType($"{input.Namespace}.DatabaseBuilder", throwOnError: true)!;
        var builder = Activator.CreateInstance(databaseBuilderType) as DatabaseBuilderBase
            ?? throw new InvalidOperationException($"{databaseBuilderType.FullName} is not a {nameof(DatabaseBuilderBase)}.");

        foreach (var table in input.Tables)
        {
            var type = assembly.GetType(table.FullTypeName, throwOnError: true)!;
            var list = new List<object>();

            foreach (var row in table.Rows)
            {
                var item = CreateObject(type, table.Fields, row);
                list.Add(item);
            }

            DatabaseBuilderExtensions.AppendDynamic(builder, type, list);
        }

        var bytes = builder.Build();
        File.WriteAllBytes(outputPath, bytes);
    }

    private static object CreateObject(Type type, IReadOnlyList<BuildField> fields, IReadOnlyDictionary<string, JsonNode?> values)
    {
        var instance = RuntimeHelpers.GetUninitializedObject(type);

        foreach (var field in fields)
        {
            var property = type.GetProperty(field.Name, BindingFlags.Instance | BindingFlags.Public)
                ?? throw new InvalidOperationException($"Property was not found: {type.FullName}.{field.Name}");

            if (!values.TryGetValue(field.Name, out var raw) || raw is null)
            {
                if (IsImmutableArray(property.PropertyType))
                {
                    property.SetValue(instance, CreateImmutableArray(property.PropertyType, Array.Empty<object>()));
                    continue;
                }

                throw new InvalidOperationException($"Required value was not found: {type.FullName}.{field.Name}");
            }

            property.SetValue(instance, ConvertValue(raw, property.PropertyType));
        }

        return instance;
    }

    private static object? ConvertValue(JsonNode raw, Type targetType)
    {
        if (targetType == typeof(string)) return raw.GetValue<string>();
        if (targetType == typeof(bool)) return raw.GetValue<bool>();
        if (targetType == typeof(int)) return raw.GetValue<int>();
        if (targetType == typeof(long)) return raw.GetValue<long>();
        if (targetType == typeof(float)) return raw.GetValue<float>();
        if (targetType == typeof(double)) return raw.GetValue<double>();

        if (targetType.IsEnum)
        {
            var value = raw.GetValue<string>();
            return string.IsNullOrEmpty(value)
                ? Activator.CreateInstance(targetType)
                : Enum.Parse(targetType, value, ignoreCase: false);
        }

        if (IsImmutableArray(targetType))
        {
            var elementType = targetType.GetGenericArguments()[0];
            var sequence = raw.AsArray();
            var array = Array.CreateInstance(elementType, sequence.Count);
            for (var i = 0; i < sequence.Count; i++)
            {
                var item = sequence[i] ?? throw new InvalidOperationException("Null list values are not supported.");
                array.SetValue(ConvertValue(item, elementType), i);
            }

            return CreateImmutableArray(targetType, array);
        }

        if (raw is JsonObject obj)
        {
            var fields = targetType
                .GetProperties(BindingFlags.Instance | BindingFlags.Public)
                .Select(property => new BuildField { Name = property.Name, Type = property.PropertyType.FullName ?? property.PropertyType.Name })
                .ToArray();
            return CreateObject(targetType, fields, obj.ToDictionary(pair => pair.Key, pair => pair.Value));
        }

        throw new InvalidOperationException($"Unsupported value conversion to {targetType.FullName}");
    }

    private static bool IsImmutableArray(Type type)
    {
        return type.IsGenericType && type.GetGenericTypeDefinition() == typeof(ImmutableArray<>);
    }

    private static object CreateImmutableArray(Type immutableArrayType, IEnumerable values)
    {
        var elementType = immutableArrayType.GetGenericArguments()[0];
        var method = typeof(MasterMemoryBinaryBuilder)
            .GetMethod(nameof(CreateImmutableArrayGeneric), BindingFlags.NonPublic | BindingFlags.Static)!
            .MakeGenericMethod(elementType);
        return method.Invoke(null, new object[] { values })!;
    }

    private static ImmutableArray<T> CreateImmutableArrayGeneric<T>(IEnumerable values)
    {
        var builder = ImmutableArray.CreateBuilder<T>();
        foreach (var value in values)
        {
            builder.Add((T)value);
        }

        return builder.ToImmutable();
    }
}
